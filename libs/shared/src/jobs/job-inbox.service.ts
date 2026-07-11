import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@saas-skeleton/database';
import type { JobContext } from './job-handler.decorator';

const UNIQUE_VIOLATION = 'P2002';

/**
 * Inbox-патерн: гарантує, що ефекти job-а застосуються рівно один раз.
 * Вставка в processed_jobs і fn виконуються в одній транзакції —
 * при retry вже обробленого job-а вставка впаде на unique constraint і fn не виконається.
 */
@Injectable()
export class JobInboxService {
  private readonly logger = new Logger(JobInboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runOnce(
    job: JobContext,
    fn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<'processed' | 'skipped'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedJob.create({ data: { id: job.id, jobName: job.name } });
        await fn(tx);
      });
      return 'processed';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        this.logger.warn(`Job ${job.name} (${job.id}) already processed — skipping`);
        return 'skipped';
      }
      throw error;
    }
  }
}
