import { Injectable, Logger } from '@nestjs/common';
import {
  JobHandler,
  JobHandlerContract,
  JobPayload,
  welcomeEmailJob,
} from '@saas-skeleton/shared';

type WelcomeEmailPayload = JobPayload<typeof welcomeEmailJob>;

/**
 * Заглушка фази 2.3: тут з'явиться реальна відправка (Mailpit у dev).
 * Природно ідемпотентна, поки нічого не робить — inbox не потрібен.
 */
@Injectable()
@JobHandler(welcomeEmailJob)
export class WelcomeEmailHandler implements JobHandlerContract<typeof welcomeEmailJob.schema> {
  private readonly logger = new Logger(WelcomeEmailHandler.name);

  handle(payload: WelcomeEmailPayload): Promise<void> {
    this.logger.log(
      `[stub] Would send welcome email to ${payload.email} (user ${payload.userId})`,
    );
    return Promise.resolve();
  }
}
