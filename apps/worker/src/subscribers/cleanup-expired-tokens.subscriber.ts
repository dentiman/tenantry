import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  cleanupExpiredTokensCommand,
} from '@saas-skeleton/shared';

/** Cron-чистка протермінованих refresh-токенів. Природно ідемпотентна — inbox не потрібен. */
@Injectable()
@MessageSubscriber({ definition: cleanupExpiredTokensCommand, id: 'token-cleaner' })
export class CleanupExpiredTokensSubscriber
  implements MessageSubscriberContract<typeof cleanupExpiredTokensCommand.schema>
{
  private readonly logger = new Logger(CleanupExpiredTokensSubscriber.name);

  constructor(
    // System-scope: крос-tenant, BYPASSRLS (tenant-контексту немає свідомо)
    private readonly prisma: SystemPrismaService,
  ) {}

  async handle(): Promise<void> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    this.logger.log(`Deleted ${String(count)} expired refresh tokens`);
  }
}
