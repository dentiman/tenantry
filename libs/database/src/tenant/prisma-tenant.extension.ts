import type { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma Client Extension — серце «невидимої» мультитенантності (§5 плану):
 * КОЖНА операція їде batch-транзакцією [set_config('app.tenant_id'), операція].
 * Це і контекст для політик RLS (MT-2), і джерело DB-default-а колонки tenant_id.
 * Extension свідомо НЕ домішує where: { tenantId } — фільтрує Postgres.
 *
 * Обмеження: інтерактивні транзакції ($transaction(fn)) обгортку ОБХОДЯТЬ —
 * для них TenantTransactions.withTenantTx (ESLint забороняє голий $transaction).
 * $queryRaw/$executeRaw теж поза обгорткою (jobs-монітор читає pgboss.* — інфра поза RLS).
 */
export function withTenantContext<T extends PrismaClient>(
  client: T,
  getTenantId: () => string | undefined,
): T {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const tenantId = getTenantId() ?? '';
          const [, result] = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
    // Структурний каст: extension не змінює API моделей, а DI-токен лишається PrismaService
  }) as unknown as T;
}
