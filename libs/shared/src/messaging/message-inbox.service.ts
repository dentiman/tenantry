import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TenantTransactions } from '@saas-skeleton/database';
import type { MessageEnvelope } from './message-envelope';

/**
 * Inbox-патерн: ефекти застосовуються рівно один раз для пари (messageId, consumerId).
 * Маркер і fn ідуть в одній транзакції: маркер вставляється як
 * `INSERT … ON CONFLICT DO NOTHING`, і count === 0 означає «цю доставку вже обробили» —
 * fn не виконується. Якщо fn кидає помилку (зокрема бізнесовий P2002 на власному INSERT),
 * вона йде назовні, а маркер відкочується разом з усіма записами fn, тож ретрай доставки
 * виконається знову. Вирішує сама вставка маркера, а не тип помилки: ніякий catch P2002
 * тут неможливий, бо він приховав би бізнесові конфлікти як «skipped».
 *
 * Конкурентні доставки одного ключа: другий INSERT чекає на коміт/відкат першої
 * транзакції. Після коміту count === 0 → skipped; після відкату маркера немає, тож
 * друга доставка вставляє його сама і виконує fn.
 *
 * Ключ — `${messageId}:${consumerId}`, а НЕ pg-boss job id (розрив §2.6). messageId
 * генерується при кожному `publish`, тому inbox захищає від ретраїв і повторної доставки
 * ТОГО САМОГО повідомлення. Свідома повторна публікація факту дає новий messageId і
 * виконується знову — захист від цього потребує бізнесового ключа ідемпотентності
 * (унікальне обмеження на доменній таблиці), а не inbox. Суфікс consumerId потрібен,
 * щоб підписники не блокували один одного: кожен обробляє повідомлення рівно раз
 * незалежно від інших.
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
    const outcome = await this.tenantTx.withTenantTx(async (tx) => {
      const { count } = await tx.processedJob.createMany({
        data: [{ id: key, jobName: envelope.name }],
        skipDuplicates: true,
      });
      if (count === 0) return 'skipped' as const;
      await fn(tx);
      return 'processed' as const;
    });
    if (outcome === 'skipped') {
      this.logger.warn(`Message ${envelope.name} already processed by ${consumerId} — skipping`);
    }
    return outcome;
  }
}
