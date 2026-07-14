import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import {
  JobHandler,
  JobHandlerContract,
  StorageService,
  filesCleanupOrphansJob,
} from '@saas-skeleton/shared';

/** PENDING старші за цей поріг вважаються покинутими (upload не завершили) */
const ORPHAN_TTL_HOURS = 24;
const BATCH_SIZE = 100;

/**
 * Cron-чистка осиротілих upload-ів: спершу S3-об'єкт (deleteObject ідемпотентний,
 * відсутність — не помилка), потім рядок. Порядок важливий: якщо впасти між кроками,
 * рядок лишиться і наступний запуск дочистить; зворотний порядок дав би object leak.
 */
@Injectable()
@JobHandler(filesCleanupOrphansJob)
export class CleanupOrphanFilesHandler
  implements JobHandlerContract<typeof filesCleanupOrphansJob.schema>
{
  private readonly logger = new Logger(CleanupOrphanFilesHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 60 * 60 * 1000);
    let removed = 0;

    for (;;) {
      const orphans = await this.prisma.file.findMany({
        where: { status: 'PENDING', createdAt: { lt: cutoff } },
        take: BATCH_SIZE,
      });
      if (orphans.length === 0) {
        break;
      }
      for (const file of orphans) {
        await this.storage.deleteObject(file.key);
        await this.prisma.file.delete({ where: { id: file.id } });
        removed += 1;
      }
    }

    this.logger.log(`Removed ${String(removed)} orphan pending files`);
  }
}
