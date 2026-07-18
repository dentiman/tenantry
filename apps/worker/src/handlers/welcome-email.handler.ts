import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import { JobHandler, JobHandlerContract, JobPayload, welcomeEmailJob } from '@saas-skeleton/shared';
import i18n from '../i18n';
import { MailerService } from '../mail/mailer.service';

type WelcomeEmailPayload = JobPayload<typeof welcomeEmailJob>;

/**
 * I18N-3: локаль і ім'я читаються свіжими з БД (не з payload) — на момент обробки
 * job-а вони можуть відрізнятися від стану при диспатчі. При реальній відправці листа
 * втрачається природна ідемпотентність заглушки: pg-boss retry після падіння ПІСЛЯ
 * успішного sendMail надішле лист повторно (at-least-once, не exactly-once). Прийнятно
 * для welcome-листа; для платіжних/юридично значущих листів такий handler мав би
 * власний inbox-запис (як JobInboxService, але для зовнішнього side effect, не БД).
 */
@Injectable()
@JobHandler(welcomeEmailJob)
export class WelcomeEmailHandler implements JobHandlerContract<typeof welcomeEmailJob.schema> {
  private readonly logger = new Logger(WelcomeEmailHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async handle(payload: WelcomeEmailPayload): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { locale: true, name: true },
    });
    const locale = user?.locale ?? 'en';
    const name = user?.name ?? payload.email;

    const subject = i18n.t('notifications:welcome.subject', { lng: locale });
    const html = i18n.t('notifications:welcome.body', { lng: locale, name });

    await this.mailer.send(payload.email, subject, html);
    this.logger.log(`Welcome email sent to ${payload.email} (locale: ${locale})`);
  }
}
