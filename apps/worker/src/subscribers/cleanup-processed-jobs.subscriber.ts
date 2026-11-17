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
 * Ключі `Idempotency-Key` REST-мутацій (docs/idempotency.md) живуть щонайменше добу: за цей час
 * клієнт точно закінчив повтори одного запиту. Після видалення запит із тим самим ключем
 * виконається як новий. Чистяться тут, а не окремою командою: це ті самі маркери
 * ідемпотентності, що й processed_jobs, лише для входу з HTTP, а не з черги.
 */
const IDEMPOTENCY_KEY_RETENTION_HOURS = 24;

/**
 * Чистка маркерів ідемпотентності: processed_jobs (inbox черги) та idempotency_keys (REST).
 * До цього processed_jobs не чистилася нічим і росла вічно (§2.6).
 * System-scope: processed_jobs — інфра-таблиця без tenant_id, ходимо під BYPASSRLS.
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

    // tenant-таблиця, але чистка — крос-tenant за віком, тому теж під BYPASSRLS
    const keysCutoff = new Date(Date.now() - IDEMPOTENCY_KEY_RETENTION_HOURS * 60 * 60 * 1000);
    const { count: keyCount } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: keysCutoff } },
    });
    this.logger.log(
      `Deleted ${String(keyCount)} idempotency keys older than ${String(IDEMPOTENCY_KEY_RETENTION_HOURS)}h`,
    );
  }
}
