import { Injectable, Logger } from '@nestjs/common';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import type { NotificationType } from '@saas-skeleton/contracts';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  NotificationRecorder,
  ScheduledNotificationService,
  dispatchScheduledNotificationsCommand,
} from '@saas-skeleton/shared';

/**
 * Сканер відкладених сповіщень (docs/calendar.md §8.3) — cron раз на хвилину.
 *
 * Три властивості, заради яких він виглядає саме так:
 *
 * 1. **Джерело правди — таблиця, а не job.** Пропущений тік нічого не втрачає:
 *    наступний побачить ті самі дозрілі рядки. Тому `retryLimit: 1` у маніфесті
 *    і жодного inbox-у: exactly-once дає атомарний `claim`, а не черга.
 * 2. **Крос-tenant пошук, доставка під RLS.** Список тенантів читається під
 *    `SystemPrismaService` (BYPASSRLS) і не несе НІЧОГО, крім `tenant_id`; далі
 *    на кожен тенант піднімається CLS, і `NotificationRecorder` працює так само,
 *    як у HTTP-запиті.
 * 3. **Політика запізнення.** Нагадування «зустріч за 30 хвилин», доставлене
 *    через годину після її початку, гірше за мовчання — тому все, що дозріло
 *    більш ніж `grace` тому (воркер лежав, деплой затягнувся), позначається
 *    `stale` і не доставляється. Це і є захист від reminder storm.
 */
const DEFAULT_GRACE_MINUTES = 10;

@Injectable()
@MessageSubscriber({
  definition: dispatchScheduledNotificationsCommand,
  id: 'scheduled-dispatcher',
})
export class DispatchScheduledNotificationsSubscriber implements MessageSubscriberContract<
  typeof dispatchScheduledNotificationsCommand.schema
> {
  private readonly logger = new Logger(DispatchScheduledNotificationsSubscriber.name);
  private readonly graceMs: number;

  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantTx: TenantTransactions,
    private readonly scheduled: ScheduledNotificationService,
    private readonly notifications: NotificationRecorder,
  ) {
    const configured = Number.parseInt(process.env.SCHEDULED_NOTIFICATIONS_GRACE_MINUTES ?? '', 10);
    this.graceMs =
      (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GRACE_MINUTES) * 60_000;
  }

  async handle(): Promise<void> {
    const now = new Date();
    const pending = await this.systemPrisma.scheduledNotification.findMany({
      where: { fireAt: { lte: now }, deliveredAt: null, claimedAt: null },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    if (pending.length === 0) {
      return;
    }

    let delivered = 0;
    let skipped = 0;
    for (const { tenantId } of pending) {
      // Один тенант не має валити тік для решти: його рядки лишаються
      // незахопленими, і наступна хвилина спробує знову
      try {
        const result = await this.tenantContext.runWith(tenantId, () => this.dispatch(now));
        delivered += result.delivered;
        skipped += result.skipped;
      } catch (error) {
        this.logger.error(
          `Scheduled dispatch failed for tenant ${tenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.logger.log(
      `Scheduled notifications: ${String(delivered)} delivered, ${String(skipped)} stale`,
    );
  }

  private async dispatch(now: Date): Promise<{ delivered: number; skipped: number }> {
    return this.tenantTx.withTenantTx(async (tx) => {
      const rows = await this.scheduled.claimDue(tx, now);
      if (rows.length === 0) {
        return { delivered: 0, skipped: 0 };
      }

      const staleBefore = now.getTime() - this.graceMs;
      const stale = rows.filter((row) => row.fireAt.getTime() < staleBefore);
      const due = rows.filter((row) => row.fireAt.getTime() >= staleBefore);

      await this.scheduled.markSkipped(
        tx,
        stale.map((row) => row.id),
        'stale',
      );

      for (const row of due) {
        await this.notifications.notify(tx, {
          type: row.type as NotificationType,
          recipientIds: [row.recipientId],
          // Актор приїхав із рядка: нагадування ставить система, а запрошення
          // колись поставить людина — форма однакова
          actor:
            row.actorType === 'user' && row.actorId
              ? { type: 'user', id: row.actorId, label: row.actorLabel ?? '' }
              : { type: 'system' },
          payload: row.payload as Record<string, unknown>,
          ...(row.targetKind && row.targetId
            ? { target: { kind: row.targetKind, id: row.targetId } }
            : {}),
          ...(row.groupKey ? { groupKey: row.groupKey } : {}),
        });
      }

      await this.scheduled.markDelivered(
        tx,
        due.map((row) => row.id),
        now,
      );

      return { delivered: due.length, skipped: stale.length };
    });
  }
}
