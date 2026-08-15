import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TenantTransactions } from '@saas-skeleton/database';
import type { MessageEnvelope } from './message-envelope';

const UNIQUE_VIOLATION = 'P2002';

/**
 * Inbox-патерн: ефекти застосовуються рівно один раз. Вставка маркера і fn ідуть
 * в одній транзакції — при повторі вставка падає на unique constraint, fn не виконується.
 *
 * Ключ — `${messageId}:${consumerId}`, а НЕ pg-boss job id (розрив §2.6). Різниця
 * принципова: job id захищає лише від ретраїв конкретного job-а, а messageId — від
 * повторної ПУБЛІКАЦІЇ того самого бізнес-факту (повторний клік, redelivery вебхука,
 * ручний реплей). Суфікс consumerId потрібен, щоб підписники не блокували один одного:
 * кожен обробляє подію рівно раз незалежно від інших.
 *
 * MT: транзакція йде через withTenantTx (перший стейтмент set_config), тому бізнес-записи
 * в fn отримують tenant-контекст. Сама processed_jobs — інфра-таблиця без tenant_id.
 */
@Injectable()
export class MessageInboxService {
  private readonly logger = new Logger(MessageInboxService.name);

  constructor(private readonly tenantTx: TenantTransactions) {}

  async runOnce(
    envelope: MessageEnvelope,
    consumerId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<'processed' | 'skipped'> {
    const key = `${envelope.messageId}:${consumerId}`;
    try {
      await this.tenantTx.withTenantTx(async (tx) => {
        await tx.processedJob.create({ data: { id: key, jobName: envelope.name } });
        await fn(tx);
      });
      return 'processed';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        this.logger.warn(`Message ${envelope.name} already processed by ${consumerId} — skipping`);
        return 'skipped';
      }
      throw error;
    }
  }
}
