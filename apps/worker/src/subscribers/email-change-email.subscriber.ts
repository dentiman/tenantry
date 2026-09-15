import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  CryptoService,
  MessageData,
  MessageEnvelope,
  MessageInboxService,
  MessageSubscriber,
  MessageSubscriberContract,
  emailChangeRequestedEvent,
} from '@saas-skeleton/shared';
import i18n from '../i18n';
import { MailerService } from '../mail/mailer.service';
import { resolveAppPublicUrl } from '../config/app-public-url';

type EmailChangeRequested = MessageData<typeof emailChangeRequestedEvent>;

const CONSUMER_ID = 'email-change-email';

/**
 * AUTH-3: підтвердження на НОВУ адресу (`data.newEmail`, а не поточну з БД) —
 * саме її власник має довести, натиснувши лінк.
 */
@Injectable()
@MessageSubscriber({ definition: emailChangeRequestedEvent, id: CONSUMER_ID })
export class EmailChangeEmailSubscriber
  implements MessageSubscriberContract<typeof emailChangeRequestedEvent.schema>
{
  private readonly logger = new Logger(EmailChangeEmailSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly inbox: MessageInboxService,
    private readonly activities: ActivityRecorder,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async handle(data: EmailChangeRequested, envelope: MessageEnvelope): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      select: { locale: true, name: true, email: true },
    });
    if (!user) {
      this.logger.warn(`Email change email skipped — user not found: ${data.userId}`);
      return;
    }

    const token = this.crypto.decrypt(data.tokenEncrypted);
    const link = `${resolveAppPublicUrl(this.config)}/confirm-email?token=${encodeURIComponent(token)}`;

    const locale = user.locale;
    const name = user.name ?? user.email;
    const subject = i18n.t('notifications:emailChangeRequested.subject', { lng: locale });
    const html = i18n.t('notifications:emailChangeRequested.body', { lng: locale, name, link });
    await this.mailer.send(data.newEmail, subject, html);
    this.logger.log(`Email change confirmation sent to ${data.newEmail}`);

    await this.inbox.runOnce(envelope, CONSUMER_ID, async (tx) => {
      await this.activities.record(tx, {
        type: 'email.sent',
        actor: envelope.actor,
        payload: {
          template: 'emailChangeRequested',
          recipient: { kind: 'user', id: data.userId, label: name },
          email: data.newEmail,
        },
        links: [{ entityType: 'user', entityId: data.userId, role: 'target' }],
      });
    });
  }
}
