import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TenantTransactions } from '@saas-skeleton/database';
import type { JobContext } from './job-handler.decorator';

const UNIQUE_VIOLATION = 'P2002';

/**
 * Inbox-патерн: гарантує, що ефекти job-а застосуються рівно один раз.
 * Вставка в processed_jobs і fn виконуються в одній транзакції —
 * при retry вже обробленого job-а вставка впаде на unique constraint і fn не виконається.
 *
 * MT-1: транзакція йде через withTenantTx — перший стейтмент set_config, тому
 * бізнес-записи в fn отримують tenant-контекст (DB-default tenant_id, RLS з MT-2).
 * Сама processed_jobs — інфра-таблиця без tenant_id (маркер ідемпотентності глобальний).
 */
@Injectable()
export class JobInboxService {
  private readonly logger = new Logger(JobInboxService.name);

  constructor(private readonly tenantTx: TenantTransactions) {}

  async runOnce(
    job: JobContext,
    fn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<'processed' | 'skipped'> {
    try {
      await this.tenantTx.withTenantTx(async (tx) => {
        await tx.processedJob.create({ data: { id: job.id, jobName: job.name } });
        await fn(tx);
      });
      return 'processed';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        this.logger.warn(`Job ${job.name} (${job.id}) already processed — skipping`);
        return 'skipped';
      }
      throw error;
    }
  }
}
