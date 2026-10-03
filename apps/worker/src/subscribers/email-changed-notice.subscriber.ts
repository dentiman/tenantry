import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  MessageData,
  MessageEnvelope,
  MessageInboxService,
  MessageSubscriber,
  MessageSubscriberContract,
  emailChangedEvent,
} from '@saas-skeleton/shared';
import i18n from '../i18n';
import { MailerService } from '../mail/mailer.service';

type EmailChanged = MessageData<typeof emailChangedEvent>;

const CONSUMER_ID = 'email-changed-notice';

/**
 * AUTH-3: сповіщення безпеки на СТАРУ адресу (`data.previousEmail`) — власник міг
 * не ініціювати зміну сам (акаунт захоплений і email підмінили). Без лінка:
 * це не дія, а факт, про який мусить дізнатись власник старої скриньки.
 */
@Injectable()
@MessageSubscriber({ definition: emailChangedEvent, id: CONSUMER_ID })
export class EmailChangedNoticeSubscriber implements MessageSubscriberContract<
  typeof emailChangedEvent.schema
> {
  private readonly logger = new Logger(EmailChangedNoticeSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly inbox: MessageInboxService,
    private readonly activities: ActivityRecorder,
  ) {}

  async handle(data: EmailChanged, envelope: MessageEnvelope): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      select: { locale: true, name: true, email: true },
    });
    if (!user) {
      this.logger.warn(`Email changed notice skipped — user not found: ${data.userId}`);
      return;
    }

    const locale = user.locale;
    const name = user.name ?? data.previousEmail;
    const subject = i18n.t('notifications:emailChanged.subject', { lng: locale });
    const html = i18n.t('notifications:emailChanged.body', { lng: locale, name });
    await this.mailer.send(data.previousEmail, subject, html);
    this.logger.log(`Email-changed security notice sent to ${data.previousEmail}`);

    await this.inbox.runOnce(envelope, CONSUMER_ID, async (tx) => {
      await this.activities.record(tx, {
        type: 'email.sent',
        actor: envelope.actor,
        payload: {
          template: 'emailChanged',
          recipient: { kind: 'user', id: data.userId, label: name },
          email: data.previousEmail,
        },
        links: [{ entityType: 'user', entityId: data.userId, role: 'target' }],
      });
    });
  }
}
