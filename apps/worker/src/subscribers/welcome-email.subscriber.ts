import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  MessageData,
  MessageEnvelope,
  MessageInboxService,
  MessageSubscriber,
  MessageSubscriberContract,
  NotificationRecorder,
  userRegisteredEvent,
} from '@saas-skeleton/shared';
import i18n from '../i18n';
import { MailerService } from '../mail/mailer.service';

type UserRegistered = MessageData<typeof userRegisteredEvent>;

const CONSUMER_ID = 'welcome-email';

/**
 * Підписник події users.user-registered.v1. Раніше цей лист був окремою командою, яку
 * ставив рукописний fan-out-хендлер; тепер fan-out робить publish, і проміжний хоп зник.
 *
 * I18N-3: локаль і ім'я читаються свіжими з БД (не з payload) — на момент обробки вони
 * можуть відрізнятися від стану на момент публікації.
 *
 * Семантика відправки — at-least-once: retry після падіння ПІСЛЯ успішного sendMail
 * надішле лист повторно. Прийнятно для welcome-листа; для платіжних/юридичних листів
 * потрібен claim-before-send (docs/event-driven-architecture.md §3.10).
 *
 * Activity log: 'email.sent' пишеться ПІСЛЯ sendMail через inbox (exactly-once відносно
 * бізнес-факту). Порядок свідомий: упав мейлер — активності нуль (фід не бреше); упало
 * між sendMail і commit-ом — лист дубльовано, активність одна.
 */
@Injectable()
@MessageSubscriber({ definition: userRegisteredEvent, id: CONSUMER_ID })
export class WelcomeEmailSubscriber implements MessageSubscriberContract<
  typeof userRegisteredEvent.schema
> {
  private readonly logger = new Logger(WelcomeEmailSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly inbox: MessageInboxService,
    private readonly activities: ActivityRecorder,
    private readonly notifications: NotificationRecorder,
  ) {}

  async handle(data: UserRegistered, envelope: MessageEnvelope): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      // tenant.name — для in-app сповіщення «Welcome to X»; читається тим самим
      // запитом, що локаль, а не окремим
      select: { locale: true, name: true, tenant: { select: { name: true } } },
    });
    const locale = user?.locale ?? 'en';
    const name = user?.name ?? data.email;

    const subject = i18n.t('notifications:welcome.subject', { lng: locale });
    const html = i18n.t('notifications:welcome.body', { lng: locale, name });
    await this.mailer.send(data.email, subject, html);
    this.logger.log(`Welcome email sent to ${data.email} (locale: ${locale})`);

    const result = await this.inbox.runOnce(envelope, CONSUMER_ID, async (tx) => {
      await this.activities.record(tx, {
        type: 'email.sent',
        // Актор приїхав із конверта: у фіді видно людину, яка створила користувача,
        // а не безлику систему (розрив §2.7 — раніше тут стояло { type: 'system' })
        actor: envelope.actor,
        payload: {
          template: 'welcome',
          recipient: { kind: 'user', id: data.userId, label: name },
          email: data.email,
        },
        links: [{ entityType: 'user', entityId: data.userId, role: 'target' }],
      });

      // In-app вітання — у ту саму транзакцію inbox-у, що й активність, тому
      // ретрай job-а його НЕ продублює (exactly-once відносно бізнес-факту,
      // на відміну від самого листа).
      //
      // Актор — система, а не envelope.actor (як в активності вище): «Ласкаво
      // просимо» надсилає застосунок, а не адмін, який завів акаунт. Хто завів —
      // видно в його власному фіді активностей
      await this.notifications.notify(tx, {
        type: 'user.welcome',
        recipientIds: [data.userId],
        actor: { type: 'system' },
        payload: { tenant: user?.tenant.name ?? '' },
      });
    });
    this.logger.debug(`Message ${envelope.messageId}: email.sent activity ${result}`);
  }
}
