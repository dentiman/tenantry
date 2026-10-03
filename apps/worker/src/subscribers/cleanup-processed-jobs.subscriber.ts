import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  cleanupProcessedJobsCommand,
} from '@saas-skeleton/shared';

/**
 * Горизонт зберігання маркерів ідемпотентності. Свідомо БІЛЬШИЙ за retention pg-boss
 * (~7-14 днів): маркер мусить пережити останній можливий retry свого повідомлення,
 * інакше його видалення відкрило б шлях повторному застосуванню ефекту.
 */
const RETENTION_DAYS = 30;

/**
 * Чистка processed_jobs. До цього таблиця не чистилася нічим і росла вічно (§2.6).
 * System-scope: інфра-таблиця без tenant_id, ходимо під BYPASSRLS.
 */
@Injectable()
@MessageSubscriber({ definition: cleanupProcessedJobsCommand, id: 'inbox-cleaner' })
export class CleanupProcessedJobsSubscriber implements MessageSubscriberContract<
  typeof cleanupProcessedJobsCommand.schema
> {
  private readonly logger = new Logger(CleanupProcessedJobsSubscriber.name);

  constructor(private readonly prisma: SystemPrismaService) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.processedJob.deleteMany({
      where: { processedAt: { lt: cutoff } },
    });
    this.logger.log(
      `Deleted ${String(count)} processed-job markers older than ${String(RETENTION_DAYS)}d`,
    );
  }
}
