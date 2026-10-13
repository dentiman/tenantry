import { Injectable, Logger } from '@nestjs/common';
import { TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { Notification as PrismaNotification, Prisma, Role } from '@saas-skeleton/database';
import {
  NOTIFICATION_PAYLOAD_SCHEMAS,
  NOTIFICATION_TYPE_META,
  type NotificationTarget,
  type NotificationType,
  type NotificationTypeMeta,
} from '@saas-skeleton/contracts';
import type { ActivityActor } from '../activities/activity-recorder.service';
import { NotificationDispatcherRegistry } from './notification-dispatcher';
import { NotificationStateService } from './notification-state.service';
import { toNotificationResponse } from './notification.mapper';

/** У V1 канал рівно один; ключ (type, channel) закладений під email/push */
const IN_APP = 'in_app';

export interface NotifyInput {
  type: NotificationType;
  /**
   * Кому. Список рахує ДОМЕН (docs/notifications.md: «хто вирішує кому» = доменний
   * модуль); порожній список — легальний no-op, а не помилка.
   */
  recipientIds: string[];
  /** Та сама форма, що ActivityActor: актор доїжджає і в чергу, і сюди */
  actor: ActivityActor;
  payload: Record<string, unknown>;
  /** Одна канонічна ціль кліку; без неї сповіщення просто нікуди не веде */
  target?: NotificationTarget;
  /**
   * Ключ колапсу в межах отримувача: доки він не прочитав, однотипні події
   * доливаються в той самий рядок (group_count++), а не плодять нові.
   */
  groupKey?: string;
}

/**
 * Розгортання ролі в список отримувачів. Експортований хелпер, який домен кличе
 * ЯВНО: рішення «сповіщаємо адмінів» лишається видимим у доменному коді, а SQL
 * не копіюється по модулях.
 *
 * Неактивні юзери відсіюються: писати в інбокс людині, яка не може залогінитись,
 * немає сенсу.
 */
export async function recipientsByRole(
  tx: Prisma.TransactionClient,
  role: Role,
  exclude: string[] = [],
): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { role, isActive: true, ...(exclude.length > 0 && { id: { notIn: exclude } }) },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

@Injectable()
export class NotificationRecorder {
  private readonly logger = new Logger(NotificationRecorder.name);

  constructor(
    private readonly tenantTx: TenantTransactions,
    private readonly tenantContext: TenantContextService,
    private readonly state: NotificationStateService,
    private readonly dispatcher: NotificationDispatcherRegistry,
  ) {}

  /**
   * tx — ПЕРШИЙ обов'язковий аргумент, як в ActivityRecorder: сповіщення пишеться
   * в ту саму транзакцію, що й доменна зміна. Інбокс не має права стверджувати те,
   * чого не сталося.
   *
   * Емісія в socket реєструється хуком after-commit тут-таки: «забути push» так само
   * неможливо, як «зробити його до коміту».
   */
  async notify(tx: Prisma.TransactionClient, input: NotifyInput): Promise<void> {
    // fail fast: невалідний payload — баг викликача, а не дані
    const payload = NOTIFICATION_PAYLOAD_SCHEMAS[input.type].parse(input.payload) as Record<
      string,
      unknown
    >;

    const recipients = await this.resolveRecipients(tx, input);
    if (recipients.length === 0) {
      return;
    }

    const tenantId = this.tenantContext.requireTenantId();

    for (const recipientId of recipients) {
      const row = await this.insertOrCollapse(tx, recipientId, input, payload);
      await this.state.bumpRevision(tx, recipientId);

      // Лічильники читаються ПІСЛЯ коміту — до нього вони показали б стан «до»
      this.tenantTx.onCommit(tx, async () => {
        const summary = await this.state.summary(recipientId);
        this.dispatcher.created(tenantId, recipientId, {
          notification: toNotificationResponse(row),
          unreadCount: summary.unreadCount,
          newCount: summary.newCount,
          revision: summary.revision,
          occurredAt: new Date().toISOString(),
        });
      });
    }

    this.logger.debug(`Notification ${input.type} recorded for ${String(recipients.length)} user(s)`);
  }

  /**
   * Прочитати сповіщення юзера за ЦІЛЛЮ (CHAT-0.2c, docs/notifications.md): людина відкрила
   * розмову — рядок «нове повідомлення» в інбоксі більше не актуальний. Та сама форма, що в
   * `NotificationsService.update`: ревізія вперед і `notification.changed` після коміту, тож
   * зникає й дзвінок, і лічильник у кожній вкладці.
   *
   * Нічого не збіглося — нічого не пишемо й не шлемо (повторне читання не має гойдати вкладки).
   * Рядки вибираються й оновлюються в тій самій транзакції; `read_at IS NULL` в умові
   * оновлення не дає двом паралельним читанням порахувати той самий рядок двічі.
   */
  async markReadByTarget(
    tx: Prisma.TransactionClient,
    userId: string,
    target: NotificationTarget,
  ): Promise<void> {
    const rows = await tx.notification.findMany({
      where: {
        recipientId: userId,
        targetKind: target.kind,
        targetId: target.id,
        readAt: null,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (rows.length === 0) {
      return;
    }
    const ids = rows.map((row) => row.id);

    const { count } = await tx.notification.updateMany({
      where: { id: { in: ids }, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      return;
    }

    await this.state.bumpRevision(tx, userId);

    const tenantId = this.tenantContext.requireTenantId();
    this.tenantTx.onCommit(tx, async () => {
      const summary = await this.state.summary(userId);
      this.dispatcher.changed(tenantId, userId, {
        change: 'read',
        scope: { kind: 'ids', ids },
        unreadCount: summary.unreadCount,
        newCount: summary.newCount,
        revision: summary.revision,
        occurredAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Два фільтри, які живуть тут, а не в домені: «не сповіщати про власну дію» і
   * преференси. Домен вирішує, КОГО стосується подія; чи не є отримувач її автором
   * і чи не вимкнув він тип — властивості інбокса. Продубльовані по модулях, вони
   * гарантовано десь забудуться.
   */
  private async resolveRecipients(
    tx: Prisma.TransactionClient,
    input: NotifyInput,
  ): Promise<string[]> {
    const actorId = input.actor.type === 'user' ? input.actor.id : null;
    const candidates = [...new Set(input.recipientIds)].filter((id) => id !== actorId);
    if (candidates.length === 0) {
      return [];
    }

    // Явна анотація, а не виведений літеральний тип: сьогодні всі типи мають
    // defaultEnabled: true, і без неї TS звужує поле до `true`, а гілку
    // «вимкнено за замовчуванням» лінтер оголошує недосяжною. Логіка потрібна
    // саме на майбутній тип, який зʼявиться вимкненим
    const meta: NotificationTypeMeta = NOTIFICATION_TYPE_META[input.type];
    // Немутабельний тип ігнорує преференси за визначенням: про зміну власного
    // пароля людина мусить дізнатись незалежно від налаштувань
    if (!meta.muteable) {
      return candidates;
    }

    const overrides = await tx.notificationPreference.findMany({
      where: { userId: { in: candidates }, type: input.type, channel: IN_APP },
      select: { userId: true, enabled: true },
    });
    const disabled = new Set(
      overrides.filter((pref) => !pref.enabled).map((pref) => pref.userId),
    );
    const enabledByDefault = meta.defaultEnabled;
    const explicitlyEnabled = new Set(
      overrides.filter((pref) => pref.enabled).map((pref) => pref.userId),
    );

    return candidates.filter((id) =>
      enabledByDefault ? !disabled.has(id) : explicitlyEnabled.has(id),
    );
  }

  /**
   * INSERT ... ON CONFLICT по ЧАСТКОВОМУ унікальному індексу
   * (tenant_id, recipient_id, group_key) WHERE group_key IS NOT NULL AND непрочитане.
   *
   * Сирий SQL тут обов'язковий, а не зручність: Prisma-upsert уміє тільки унікальні
   * констрейнти зі схеми і частковий індекс як арбітр не візьме. Ціна альтернативи —
   * «SELECT, потім UPDATE» з гонкою між паралельними fan-out-ами.
   *
   * Рядок без groupKey предикату не задовольняє, тому в індекс не потрапляє і
   * конфлікту не дає — той самий стейтмент обслуговує обидва випадки.
   */
  private async insertOrCollapse(
    tx: Prisma.TransactionClient,
    recipientId: string,
    input: NotifyInput,
    payload: Record<string, unknown>,
  ): Promise<PrismaNotification> {
    const actorId = input.actor.type === 'user' ? input.actor.id : null;
    const actorLabel = input.actor.type === 'user' ? input.actor.label : null;

    const rows = await tx.$queryRaw<PrismaNotification[]>`
      INSERT INTO notifications (
        id, tenant_id, recipient_id, type, payload,
        target_kind, target_id, group_key, group_count,
        actor_type, actor_id, actor_label, created_at, updated_at
      )
      VALUES (
        gen_random_uuid()::text,
        nullif(current_setting('app.tenant_id', true), ''),
        ${recipientId},
        ${input.type},
        ${JSON.stringify(payload)}::jsonb,
        ${input.target?.kind ?? null},
        ${input.target?.id ?? null},
        ${input.groupKey ?? null},
        1,
        ${input.actor.type},
        ${actorId},
        ${actorLabel},
        now(),
        now()
      )
      ON CONFLICT (tenant_id, recipient_id, group_key)
        WHERE group_key IS NOT NULL AND read_at IS NULL AND archived_at IS NULL
      DO UPDATE SET
        group_count = notifications.group_count + 1,
        -- payload і актор — від НАЙСВІЖІШОЇ події групи: рядок показує останнє,
        -- а group_count каже, скільки їх було
        payload     = EXCLUDED.payload,
        target_kind = EXCLUDED.target_kind,
        target_id   = EXCLUDED.target_id,
        actor_type  = EXCLUDED.actor_type,
        actor_id    = EXCLUDED.actor_id,
        actor_label = EXCLUDED.actor_label,
        updated_at  = now()
      RETURNING
        id,
        tenant_id    AS "tenantId",
        recipient_id AS "recipientId",
        type,
        payload,
        target_kind  AS "targetKind",
        target_id    AS "targetId",
        group_key    AS "groupKey",
        group_count  AS "groupCount",
        actor_type   AS "actorType",
        actor_id     AS "actorId",
        actor_label  AS "actorLabel",
        created_at   AS "createdAt",
        updated_at   AS "updatedAt",
        read_at      AS "readAt",
        archived_at  AS "archivedAt"
    `;

    const row = rows[0];
    if (!row) {
      // ON CONFLICT DO UPDATE завжди повертає рядок; порожньо = запис не пройшов
      // політику RLS, тобто контекст тенанта не той, у якому живе отримувач
      throw new Error(`Notification insert returned no row for recipient ${recipientId}`);
    }
    return row;
  }
}
