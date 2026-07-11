import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import {
  JobHandler,
  JobHandlerContract,
  authCleanupExpiredTokensJob,
} from '@saas-skeleton/shared';

/** Cron-чистка протермінованих refresh-токенів. Природно ідемпотентна — inbox не потрібен. */
@Injectable()
@JobHandler(authCleanupExpiredTokensJob)
export class CleanupExpiredTokensHandler
  implements JobHandlerContract<typeof authCleanupExpiredTokensJob.schema>
{
  private readonly logger = new Logger(CleanupExpiredTokensHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(): Promise<void> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    this.logger.log(`Deleted ${String(count)} expired refresh tokens`);
  }
}
