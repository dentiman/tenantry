import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TenantContextService } from '@saas-skeleton/database';
import { CUSTOMER_EXPORT_MAX_ROWS, type ExportCustomers } from '@saas-skeleton/contracts';
import {
  CSV_BOM,
  CUSTOMER_CSV_HEADER,
  MessageData,
  MessageSubscriber,
  MessageSubscriberContract,
  NumberingService,
  StorageService,
  UserOperationRunner,
  csvLine,
  customerCsvLine,
  customerListOrderBy,
  customerListWhere,
  exportCustomersCommand,
} from '@saas-skeleton/shared';

type ExportCustomersMessage = MessageData<typeof exportCustomersCommand>;

/** Рядків на сторінку: між сторінками — прогрес і контрольна точка скасування */
const PAGE_SIZE = 500;

/**
 * Експорт клієнтів у CSV (openspec: customers/export) — обробник операції користувача.
 * Захоплення, heartbeat, скасування, сповіщення й фінальний стан веде `UserOperationRunner`;
 * тут лише сама робота. Ідемпотентність — захоплення операції, а не inbox: повтор job-а
 * будує файл заново під тим самим ключем, тобто перезаписує, а не дублює.
 */
@Injectable()
@MessageSubscriber({ definition: exportCustomersCommand, id: 'customers-exporter' })
export class ExportCustomersSubscriber implements MessageSubscriberContract<
  typeof exportCustomersCommand.schema
> {
  private readonly logger = new Logger(ExportCustomersSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: UserOperationRunner,
    private readonly numbering: NumberingService,
    private readonly storage: StorageService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async handle(data: ExportCustomersMessage): Promise<void> {
    const outcome = await this.runner.run<ExportCustomers>(
      data.userOperationId,
      'customers.export',
      async (context) => {
        const where = customerListWhere(context.params);
        const orderBy = customerListOrderBy(context.params);
        // Межу перевірив старт; тут вона страхує від того, що збігів стало більше за цей час
        const total = Math.min(await this.prisma.customer.count({ where }), CUSTOMER_EXPORT_MAX_ROWS);
        const series = await this.numbering.resolve('customer');

        const lines: string[] = [CSV_BOM, csvLine(CUSTOMER_CSV_HEADER)];
        let written = 0;
        await context.progress(0, total);
        while (written < total) {
          const page = await this.prisma.customer.findMany({
            where,
            orderBy,
            skip: written,
            take: Math.min(PAGE_SIZE, total - written),
            include: { owner: { select: { email: true } } },
          });
          if (page.length === 0) {
            break;
          }
          for (const customer of page) {
            lines.push(
              customerCsvLine({
                numberLabel: this.numbering.format(series, customer.number),
                name: customer.name,
                kind: customer.kind,
                status: customer.status,
                email: customer.email,
                phone: customer.phone,
                ownerEmail: customer.owner?.email ?? null,
                tags: customer.tags,
                createdAt: customer.createdAt,
              }),
            );
          }
          written += page.length;
          await context.progress(written, total);
        }
        await context.checkpoint();

        const filename = context.operation.title;
        const key = `${this.tenantContext.requireTenantId()}/user-operations/${context.operation.id}/${filename}`;
        // Зовнішній виклик — поза будь-якою транзакцією (backend-conventions §5)
        await this.storage.putObject(
          key,
          new TextEncoder().encode(lines.join('')),
          'text/csv; charset=utf-8',
        );
        return { result: { rowCount: written, filename }, resultKey: key };
      },
    );
    this.logger.log(`Customer export ${data.userOperationId}: ${outcome}`);
  }
}
