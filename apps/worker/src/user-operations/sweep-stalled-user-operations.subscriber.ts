import { Injectable, Logger } from '@nestjs/common';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { USER_OPERATION_STALL_MINUTES } from '@saas-skeleton/contracts';
import {
  MessageSubscriber,
  MessageSubscriberContract,
  UserOperationsService,
  sweepStalledUserOperationsCommand,
} from '@saas-skeleton/shared';

/** Скільки зависших закривати за один тік; решта дочекається наступного */
const BATCH = 200;

/**
 * Зависла операція → FAILED/STALLED (docs/user-operations.md §5). Гарантія «операція не лишається
 * RUNNING назавжди»: воркер міг упасти, job — вичерпати повтори й лягти в `dlq`.
 *
 * Перелік — під BYPASSRLS (по всіх тенантах), а сам перехід — у tenant-контексті операції:
 * сповіщення власнику пишеться в його тенант. Умова переходу повторює умову вибірки, тож
 * операція, що встигла ожити між ними, не постраждає.
 */
@Injectable()
@MessageSubscriber({ definition: sweepStalledUserOperationsCommand, id: 'user-operations-sweeper' })
export class SweepStalledUserOperationsSubscriber implements MessageSubscriberContract<
  typeof sweepStalledUserOperationsCommand.schema
> {
  private readonly logger = new Logger(SweepStalledUserOperationsSubscriber.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantTx: TenantTransactions,
    private readonly operations: UserOperationsService,
  ) {}

  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - USER_OPERATION_STALL_MINUTES * 60 * 1000);
    const stalled = await this.system.userOperation.findMany({
      where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
      select: { id: true, tenantId: true },
      take: BATCH,
    });
    let failed = 0;
    for (const { id, tenantId } of stalled) {
      const row = await this.tenantContext.runWith(tenantId, () =>
        this.tenantTx.withTenantTx((tx) =>
          this.operations.fail(tx, { id, status: 'RUNNING', heartbeatAt: { lt: cutoff } }, 'STALLED'),
        ),
      );
      if (row) {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.logger.warn(`Marked ${String(failed)} stalled user operation(s) as FAILED`);
    }
  }
}
