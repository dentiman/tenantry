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
  passwordResetRequestedEvent,
} from '@saas-skeleton/shared';
import i18n from '../i18n';
import { MailerService } from '../mail/mailer.service';
import { resolveAppPublicUrl } from '../config/app-public-url';

type PasswordResetRequested = MessageData<typeof passwordResetRequestedEvent>;

const CONSUMER_ID = 'password-reset-email';

/**
 * AUTH-3: лист скидання пароля. `tokenEncrypted` розшифровується ЛИШЕ в пам'яті,
 * прямо перед рендером посилання — ні сирий токен, ні розшифрований варіант у
 * лог НЕ пишуться (contracts/events-and-config.md §1).
 */
@Injectable()
@MessageSubscriber({ definition: passwordResetRequestedEvent, id: CONSUMER_ID })
export class PasswordResetEmailSubscriber implements MessageSubscriberContract<
  typeof passwordResetRequestedEvent.schema
> {
  private readonly logger = new Logger(PasswordResetEmailSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly inbox: MessageInboxService,
    private readonly activities: ActivityRecorder,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async handle(data: PasswordResetRequested, envelope: MessageEnvelope): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true, locale: true, name: true },
    });
    if (!user) {
      // Юзера видалили між публікацією і обробкою — лист нема кому слати
      this.logger.warn(`Password reset email skipped — user not found: ${data.userId}`);
      return;
    }

    const token = this.crypto.decrypt(data.tokenEncrypted);
    const link = `${resolveAppPublicUrl(this.config)}/reset-password/confirm?token=${encodeURIComponent(token)}`;

    const locale = user.locale;
    const name = user.name ?? user.email;
    const subject = i18n.t('notifications:passwordReset.subject', { lng: locale });
    const html = i18n.t('notifications:passwordReset.body', { lng: locale, name, link });
    await this.mailer.send(user.email, subject, html);
    this.logger.log(`Password reset email sent to ${user.email}`);

    await this.inbox.runOnce(envelope, CONSUMER_ID, async (tx) => {
      await this.activities.record(tx, {
        type: 'email.sent',
        actor: envelope.actor,
        payload: {
          template: 'passwordReset',
          recipient: { kind: 'user', id: data.userId, label: name },
          email: user.email,
        },
        links: [{ entityType: 'user', entityId: data.userId, role: 'target' }],
      });
    });
  }
}
