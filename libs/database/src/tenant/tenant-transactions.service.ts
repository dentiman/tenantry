import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PRISMA_BASE } from './tokens';
import type { PrismaService } from '../prisma.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Інтерактивні транзакції під tenant-контекстом: перший стейтмент — set_config,
 * далі fn на тому самому конекшені. Єдиний легальний спосіб відкрити транзакцію
 * в доменному коді (голий prisma.$transaction обходить tenant-extension і
 * заборонений ESLint-ом). Працює на BASE-клієнті — без подвійної обгортки.
 */
@Injectable()
export class TenantTransactions {
  constructor(
    @Inject(PRISMA_BASE) private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async withTenantTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenantId = this.tenantContext.getTenantId() ?? '';
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return fn(tx);
    });
  }
}
