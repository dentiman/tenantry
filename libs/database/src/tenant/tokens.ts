/**
 * DI-токен «голого» PrismaClient БЕЗ tenant-extension. Тільки для інфраструктури
 * (TenantTransactions); доменний код інжектить PrismaService і отримує extended-клієнт.
 */
export const PRISMA_BASE = Symbol('PRISMA_BASE');
