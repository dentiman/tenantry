import { Injectable, Logger } from '@nestjs/common';
import {
  JobContext,
  JobDispatcher,
  JobHandler,
  JobHandlerContract,
  JobInboxService,
  JobPayload,
  userRegisteredJob,
  welcomeEmailJob,
} from '@saas-skeleton/shared';

type UserRegisteredPayload = JobPayload<typeof userRegisteredJob>;

/**
 * Fan-out від події: реєстрація користувача породжує похідні задачі.
 * Inbox гарантує exactly-once, а send(..., { tx }) ставить welcome-email
 * у ТІЙ САМІЙ транзакції, що й inbox-запис — або все, або нічого.
 */
@Injectable()
@JobHandler(userRegisteredJob)
export class UserRegisteredHandler implements JobHandlerContract<typeof userRegisteredJob.schema> {
  private readonly logger = new Logger(UserRegisteredHandler.name);

  constructor(
    private readonly inbox: JobInboxService,
    private readonly jobDispatcher: JobDispatcher,
  ) {}

  async handle(payload: UserRegisteredPayload, context: JobContext): Promise<void> {
    const result = await this.inbox.runOnce(context, async (tx) => {
      await this.jobDispatcher.send(
        welcomeEmailJob,
        { userId: payload.userId, email: payload.email },
        { singletonKey: payload.userId, tx },
      );
      this.logger.log(`User registered: ${payload.email} — welcome email enqueued`);
    });
    this.logger.debug(`Job ${context.id}: ${result}`);
  }
}
