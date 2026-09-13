import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  cleanupExpiredTokensCommand,
} from '@saas-skeleton/shared';

/**
 * Cron-чистка мертвих сесій. Природно ідемпотентна — inbox не потрібен.
 *
 * Ім'я команди й черги лишилось `auth.cleanup-expired-tokens` навмисно: перейменування
 * означало б нову чергу, а джоби зі старим іменем тихо лягли б у нечитану.
 */
/** Скільки мертва сесія лишається читабельною для розслідування */
const RETENTION_DAYS = 30;

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
    // Відкликані й протерміновані сесії лежать ще 30 днів: рядок — це слід, за яким
    // розбирають інцидент («коли саме вбили цю сесію і чому»), і видаляти його
    // одразу означало б стерти доказ разом із проблемою
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.authSession.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: cutoff } },
          // Умова на idle обов'язкова, а не дубль absolute: сесія, що спливла від
          // бездіяльності на 2-й день, інакше чекала б absolute (30 днів) + 30 днів
          // retention, тобто до 60 днів (spec FR-017)
          { idleExpiresAt: { lt: cutoff } },
          { absoluteExpiresAt: { lt: cutoff } },
        ],
      },
    });
    this.logger.log(`Deleted ${String(count)} dead auth sessions`);
  }
}
