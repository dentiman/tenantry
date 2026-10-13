import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { NormalizedStatusEvent } from '@saas-skeleton/contracts';
import {
  ChannelStatusService,
  PENDING_STATUS_MAX_ATTEMPTS,
  type MessageRef,
} from './channel-status.service';

/** Скільки запаркованих квитанцій беремо за один прохід */
const SWEEP_BATCH = 500;

export interface SweepResult {
  applied: number;
  discarded: number;
  /** Повідомлення, чий стан змінився, по тенантах — для сигналу «перечитай» */
  updated: { tenantId: string; message: MessageRef }[];
}

/**
 * Підмітання квитанцій, що випередили запис `external_id` (CHAT-2b, design.md D10). Запускається
 * кроном раз на хвилину в системному scope, а КОЖЕН рядок обробляється вже під контекстом свого
 * тенанта (`runWith` + `withTenantTx`), тобто під RLS: системний клієнт лише перелічує, що є.
 *
 * Квитанція, що не знайшла повідомлення, отримує +1 до `attempts`; після `PENDING_STATUS_MAX_ATTEMPTS`
 * відкидається з попередженням у лозі (повідомлення, якого немає, не зʼявиться).
 */
@Injectable()
export class ChannelPendingSweeper {
  private readonly logger = new Logger(ChannelPendingSweeper.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly transactions: TenantTransactions,
    private readonly statuses: ChannelStatusService,
  ) {}

  async sweep(): Promise<SweepResult> {
    const rows = await this.system.channelPendingStatus.findMany({
      orderBy: { createdAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true, tenantId: true },
    });
    const byTenant = new Map<string, string[]>();
    for (const row of rows) {
      byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) ?? []), row.id]);
    }

    const result: SweepResult = { applied: 0, discarded: 0, updated: [] };
    for (const [tenantId, ids] of byTenant) {
      const part = await this.tenantContext.runWith(tenantId, () =>
        this.transactions.withTenantTx(async (tx) => {
          const part: SweepResult = { applied: 0, discarded: 0, updated: [] };
          const pending = await tx.channelPendingStatus.findMany({ where: { id: { in: ids } } });
          for (const row of pending) {
            const channel = await tx.channel.findFirst({
              where: { accountId: row.accountId, externalId: row.channelExternalId },
              select: { id: true },
            });
            const fold = channel
              ? await this.statuses.fold(tx, channel.id, {
                  externalMessageId: row.externalId ?? '',
                  opaqueId: row.opaqueId,
                  status: row.status as NormalizedStatusEvent['status'],
                  occurredAt: row.occurredAt.toISOString(),
                  failure: (row.failure as NormalizedStatusEvent['failure']) ?? null,
                })
              : { matched: false, changed: null };

            if (fold.matched) {
              await tx.channelPendingStatus.delete({ where: { id: row.id } });
              part.applied += 1;
              if (fold.changed) part.updated.push({ tenantId, message: fold.changed });
            } else if (row.attempts + 1 >= PENDING_STATUS_MAX_ATTEMPTS) {
              await tx.channelPendingStatus.delete({ where: { id: row.id } });
              part.discarded += 1;
            } else {
              await tx.channelPendingStatus.update({
                where: { id: row.id },
                data: { attempts: { increment: 1 } },
              });
            }
          }
          return part;
        }),
      );
      result.applied += part.applied;
      result.discarded += part.discarded;
      result.updated.push(...part.updated);
    }

    this.statuses.logDiscard(result.discarded);
    return result;
  }
}
