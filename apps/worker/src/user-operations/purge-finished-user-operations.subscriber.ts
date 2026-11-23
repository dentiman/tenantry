import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import { USER_OPERATION_RETENTION_DAYS } from '@saas-skeleton/contracts';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  StorageService,
  purgeFinishedUserOperationsCommand,
} from '@saas-skeleton/shared';

const BATCH = 500;

/**
 * Завершені операції старші за 30 днів — разом із файлами результату (рішення 2026-11-17).
 * Спершу обʼєкт, потім рядок: рядок без обʼєкта нешкідливий (посилання дасть 404 сховища), а
 * обʼєкт без рядка вже ніхто не знайде й не прибере. Природно ідемпотентна — inbox не потрібен.
 */
@Injectable()
@MessageSubscriber({ definition: purgeFinishedUserOperationsCommand, id: 'user-operations-purger' })
export class PurgeFinishedUserOperationsSubscriber implements MessageSubscriberContract<
  typeof purgeFinishedUserOperationsCommand.schema
> {
  private readonly logger = new Logger(PurgeFinishedUserOperationsSubscriber.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly storage: StorageService,
  ) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - USER_OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const batch = await this.system.userOperation.findMany({
        where: { finishedAt: { lt: cutoff } },
        select: { id: true, resultKey: true },
        take: BATCH,
      });
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        if (row.resultKey) {
          await this.storage.deleteObject(row.resultKey);
        }
      }
      const { count } = await this.system.userOperation.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      total += count;
      if (batch.length < BATCH) {
        break;
      }
    }
    this.logger.log(`Purged ${String(total)} finished user operation(s)`);
  }
}
