import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';
import { withTenantContext } from './tenant/prisma-tenant.extension';
import { PRISMA_BASE } from './tenant/tokens';

/**
 * MT-1: під токеном PrismaService живе tenant-extended клієнт — доменний код
 * інжектить PrismaService як і раніше й НЕ знає про мультитенантність (§0/§6 плану).
 * Голий клієнт (PRISMA_BASE) — лише для інфраструктури (TenantTransactions).
 * Потребує TenancyModule.forRoot() у корені застосунку (дає ClsService глобально).
 */
@Global()
@Module({
  providers: [
    { provide: PRISMA_BASE, useClass: PrismaService },
    {
      provide: PrismaService,
      inject: [PRISMA_BASE, ClsService],
      useFactory: (base: PrismaService, cls: ClsService): PrismaService => {
        // Не інжектимо TenantContextService (він у TenancyModule) — читаємо CLS напряму;
        // семантика та сама, що TenantContextService.getTenantId()
        const getTenantId = (): string | undefined =>
          cls.isActive() ? cls.get<string | undefined>('tenantId') : undefined;
        return withTenantContext(base, getTenantId);
      },
    },
    SystemPrismaService,
  ],
  exports: [PrismaService, PRISMA_BASE, SystemPrismaService],
})
export class PrismaModule {}
