import '../../load-root-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../contracts/src/demo';
import { PrismaClient } from '../../src/generated/prisma/client';
import { brightside } from './datasets/brightside';
import { helix } from './datasets/helix';
import { northwind } from './datasets/northwind';
import { seedTenant, type TenantSeedStats } from './seed-tenant';
import type { DemoTenantDataset } from './types';

/**
 * Демо-датасет для показу клієнтам (docs/demo.md): три галузеві тенанти з командою,
 * десятками кастомерів, календарем, чатом, журналом і сповіщеннями.
 *
 *   pnpm db:seed:demo          — створити/оновити (ідемпотентно; повторний запуск зсуває дати календаря)
 *   pnpm db:seed:demo:reset    — видалити демо-тенанти (каскадом) і створити заново: чистий стан перед показом
 *
 * Тенант `default` і оператор платформи — зона базового `pnpm db:seed`; цей скрипт їх НЕ чіпає
 * і не видаляє, тож скидання демо безпечне для робочого dev-стенду.
 * Запускається під `saas_platform` (BYPASSRLS), як і базовий сід.
 */
const DEFAULT_PLATFORM_DATABASE_URL = 'postgresql://saas_platform:saas_platform@localhost:5432/saas_skeleton';

const DATASETS: readonly DemoTenantDataset[] = [northwind, helix, brightside];

/** Демо-акаунти з контракту мусять існувати в ростері рівно такими — інакше чипи логіну поведуть у нікуди */
function assertAccountsMatchRosters(): void {
  for (const account of DEMO_ACCOUNTS) {
    if (account.tenant === 'default') continue;
    const dataset = DATASETS.find((d) => d.slug === account.tenant);
    const user = dataset?.users.find((u) => u.email === account.email);
    if (user?.name !== account.name || user.role !== account.role) {
      throw new Error(`Demo account ${account.email} (${account.tenant}) does not match the dataset roster`);
    }
  }
}

async function main(): Promise<void> {
  assertAccountsMatchRosters();
  const reset = process.argv.includes('--reset');

  const adapter = new PrismaPg({ connectionString: process.env.PLATFORM_DATABASE_URL ?? DEFAULT_PLATFORM_DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const log = (message: string): void => {
    console.log(message);
  };

  try {
    if (reset) {
      const { count } = await prisma.tenant.deleteMany({ where: { slug: { in: DATASETS.map((d) => d.slug) } } });
      log(`Reset: removed ${String(count)} demo tenant(s)`);
    }

    const now = new Date();
    const stats: TenantSeedStats[] = [];
    log('Seeding demo tenants…');
    for (const dataset of DATASETS) {
      stats.push(await seedTenant(prisma, dataset, now, log));
    }

    const sum = (pick: (s: TenantSeedStats) => number): number => stats.reduce((acc, s) => acc + pick(s), 0);
    log('');
    log(
      `Done: ${String(stats.length)} tenants, ${String(sum((s) => s.users))} users, ${String(sum((s) => s.events))} calendar events (refreshed to today). ` +
        `Added this run: ${String(sum((s) => s.customers))} customers, ${String(sum((s) => s.contacts))} contacts, ${String(sum((s) => s.messages))} chat messages, ` +
        `${String(sum((s) => s.activities))} activity records, ${String(sum((s) => s.notifications))} notifications`,
    );
    log('');
    log(`Sign in (password for the industry tenants: ${DEMO_PASSWORD}):`);
    for (const account of DEMO_ACCOUNTS) {
      log(`  ${account.tenant.padEnd(11)} ${account.email.padEnd(38)} ${account.password}  (${account.roleLabel})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
