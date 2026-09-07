import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@saas-skeleton/database';
import type { ScheduledNotification } from '@saas-skeleton/database';
import type { NotificationTarget, NotificationType } from '@saas-skeleton/contracts';
import type { ActivityActor } from '../activities/activity-recorder.service';

/**
 * Відкладені сповіщення — СПІЛЬНА інфраструктура (docs/notifications.md
 * § «Обмеження V1 / беклог», roadmap §2.1), а не частина календаря: у назвах
 * колонок і методів немає жодного `calendar`. Календар — перший споживач.
 *
 * Два рівні (docs/calendar.md §8.1): домен тримає ДЕКЛАРАЦІЮ («за 30 хв до»), а
 * тут живе МАТЕРІАЛІЗАЦІЯ («спрацювати о 14:30»). Той самий поділ, що
 * `number_series` / `number_sequences`: конфіг окремо, розрахований стан окремо.
 * Без нього неможливо відповісти «що спрацює найближчі 5 хвилин» одним
 * індексованим запитом.
 *
 * Чому не `pg-boss` із `startAfter` (§8.2 доку): `pgboss.*` поза RLS — рівно
 * той аргумент, який переніс `/jobs` у platform-api; плюс ретеншн черги,
 * скасування як друге джерело правди і гонки при перепрануванні.
 */

export interface ScheduleNotificationInput {
  /** Момент доставки. Рахує домен — він знає, від чого відлічувати */
  fireAt: Date;
  /**
   * Ключ ідемпотентності матеріалізації, стабільний для того самого факту:
   * `calendar_reminder:{reminderId}:{occurrenceStart}`. Повторна матеріалізація
   * (ретрай, дві вкладки) не плодить дублів, а `occurrenceStart` у ключі — те,
   * що дозволить матеріалізувати горизонт серій у CAL-4.
   */
  dedupeKey: string;
  recipientId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  target?: NotificationTarget;
  groupKey?: string;
  /** Та сама форма, що в ActivityRecorder і NotificationRecorder */
  actor: ActivityActor;
}

/** Скільки рядків сканер бере за один тік (стеля на випадок сплеску) */
const CLAIM_BATCH = 200;

@Injectable()
export class ScheduledNotificationService {
  private readonly logger = new Logger(ScheduledNotificationService.name);

  /**
   * Запланувати. `tx` — ПЕРШИЙ обовʼязковий аргумент, як у recorder-ах: рядок
   * пишеться в ту саму транзакцію, що й доменна зміна, від якої він походить.
   *
   * `createMany` + `skipDuplicates`, а не upsert: конфлікт по `dedupeKey`
   * означає «цей самий факт уже запланований», і правильна реакція — нічого не
   * робити. Заодно не потрібен явний `tenantId` у `where` (його кладе
   * DB-default із CLS), тобто домен лишається без згадок MT.
   */
  async schedule(
    tx: Prisma.TransactionClient,
    inputs: readonly ScheduleNotificationInput[],
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const { count } = await tx.scheduledNotification.createMany({
      data: inputs.map((input) => ({
        fireAt: input.fireAt,
        dedupeKey: input.dedupeKey,
        recipientId: input.recipientId,
        type: input.type,
        // Асерція потрібна саме тут (на відміну від recorder-а, який пише сирим
        // SQL): createMany типізує JSON-колонку як InputJsonValue, а
        // Record<string, unknown> під нього не підходить структурно
        payload: input.payload as Prisma.InputJsonObject,
        targetKind: input.target?.kind ?? null,
        targetId: input.target?.id ?? null,
        groupKey: input.groupKey ?? null,
        actorType: input.actor.type,
        actorId: input.actor.type === 'user' ? input.actor.id : null,
        actorLabel: input.actor.type === 'user' ? input.actor.label : null,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Скасувати заплановане за префіксом ключа: перепланування події = `cancel`
   * + `schedule` у ТІЙ САМІЙ транзакції, що й сама зміна.
   *
   * Видаляються лише рядки, які ще ніхто не захопив
   * (`claimedAt: null, deliveredAt: null`): захоплений рядок уже в роботі
   * сканера, і його доставка — правда про минуле, яку не переписують.
   */
  async cancel(
    tx: Prisma.TransactionClient,
    filter: { dedupeKeyPrefix: string; recipientId?: string },
  ): Promise<number> {
    const { count } = await tx.scheduledNotification.deleteMany({
      where: {
        dedupeKey: { startsWith: filter.dedupeKeyPrefix },
        ...(filter.recipientId && { recipientId: filter.recipientId }),
        claimedAt: null,
        deliveredAt: null,
      },
    });
    return count;
  }

  /**
   * Захопити дозріле. Атомарний `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
   * LOCKED)`: exactly-once дає САМ claim, тому `MessageInboxService` тут не
   * потрібен — та сама доктрина, що з колапсом сповіщень («атомарний SQL —
   * перший рубіж, а не політика черги»).
   *
   * Два зауваження, кожне з яких уже коштувало часу в цьому репозиторії:
   *
   * 1. **Сирий SQL обходить tenant-extension** (грабля RT-3): без зовнішнього
   *    `runWith → withTenantTx` під `saas_app` RLS відфільтрує все МОВЧКИ. Тут
   *    ми вже всередині транзакції з `set_config`, тому політика бачить тенант.
   * 2. **`now` приходить параметром, а не як `now()` у SQL.** Колонки —
   *    `timestamp(3)` без зони (успадкована конвенція Prisma в цьому репо), а
   *    `now()` віддає `timestamptz`: Postgres звів би їх через `TimeZone`
   *    сесії, тобто результат залежав би від налаштування конекшена. Заодно це
   *    робить тест детермінованим — «зараз» можна передати.
   * 3. **`RETURNING` перелічує колонки з аліасами, а не `*`.** `$queryRaw` віддає
   *    РЕАЛЬНІ імена колонок (`fire_at`), а не Prisma-мапінг, тому `*` дав би
   *    обʼєкт, у якому всі camelCase-поля `undefined` — і жодної помилки типів
   *    (той самий прийом, що в `NotificationRecorder.insertOrCollapse`).
   */
  async claimDue(
    tx: Prisma.TransactionClient,
    now: Date,
    limit = CLAIM_BATCH,
  ): Promise<ScheduledNotification[]> {
    return tx.$queryRaw<ScheduledNotification[]>`
      UPDATE scheduled_notifications
         SET claimed_at = ${now}
       WHERE id IN (
         SELECT id
           FROM scheduled_notifications
          WHERE fire_at <= ${now}
            AND delivered_at IS NULL
            AND claimed_at IS NULL
          ORDER BY fire_at
          LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING
        id,
        tenant_id      AS "tenantId",
        fire_at        AS "fireAt",
        dedupe_key     AS "dedupeKey",
        recipient_id   AS "recipientId",
        type,
        payload,
        target_kind    AS "targetKind",
        target_id      AS "targetId",
        group_key      AS "groupKey",
        actor_type     AS "actorType",
        actor_id       AS "actorId",
        actor_label    AS "actorLabel",
        claimed_at     AS "claimedAt",
        delivered_at   AS "deliveredAt",
        skipped_reason AS "skippedReason",
        created_at     AS "createdAt"
    `;
  }

  /** Доставлено — рядок остаточний і з робочого набору сканера випадає */
  async markDelivered(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    at: Date,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await tx.scheduledNotification.updateMany({
      where: { id: { in: [...ids] } },
      data: { deliveredAt: at },
    });
  }

  /**
   * Пропущено. `delivered_at` лишається NULL — рядок не доставляли; з робочого
   * набору сканера його вже вивів `claimed_at`, тому повторно він не візьметься.
   */
  async markSkipped(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    reason: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await tx.scheduledNotification.updateMany({
      where: { id: { in: [...ids] } },
      data: { skippedReason: reason },
    });
    this.logger.warn(`Skipped ${String(ids.length)} scheduled notification(s): ${reason}`);
  }
}
