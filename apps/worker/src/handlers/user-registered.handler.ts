import { Injectable, Logger } from '@nestjs/common';
import {
  JobContext,
  JobHandler,
  JobHandlerContract,
  JobInboxService,
  JobPayload,
  userRegisteredJob,
} from '@saas-skeleton/shared';

type UserRegisteredPayload = JobPayload<typeof userRegisteredJob>;

/**
 * Демо-споживач події реєстрації через inbox (exactly-once для DB-ефектів).
 * У фазі 2.3 сюди підключиться notifications (welcome-email через Mailpit).
 */
@Injectable()
@JobHandler(userRegisteredJob)
export class UserRegisteredHandler implements JobHandlerContract<typeof userRegisteredJob.schema> {
  private readonly logger = new Logger(UserRegisteredHandler.name);

  constructor(private readonly inbox: JobInboxService) {}

  async handle(payload: UserRegisteredPayload, context: JobContext): Promise<void> {
    const result = await this.inbox.runOnce(context, async () => {
      this.logger.log(`User registered: ${payload.email} (${payload.userId})`);
      await Promise.resolve();
    });
    this.logger.debug(`Job ${context.id}: ${result}`);
  }
}
