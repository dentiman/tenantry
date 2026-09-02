import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Розмір пулу з env. У проді не задаємо — діє дефолт драйвера (10 конекшенів на
 * процес). Потрібно це e2e: там у ОДНОМУ jest-процесі послідовно піднімається
 * десяток Nest-застосунків, кожен зі своїм пулом, і сумарно вони впираються в
 * `max_connections` Postgres-а. Симптом був неочевидний — випадкові 503 і дивні
 * статуси в СУСІДНІХ сьютах (P2024 «timed out fetching a connection»), а не
 * чесна помилка підключення.
 */
function poolMax(): number | undefined {
  const raw = process.env.DATABASE_POOL_MAX;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
import { PrismaClient } from './generated/prisma/client';

// Роль saas_platform: BYPASSRLS (MT-0). Для control plane і системних КРОС-tenant
// операцій (cron cleanup-джоби). БЕЗ tenant-extension — set_config їй не потрібен.
const DEFAULT_PLATFORM_DATABASE_URL =
  'postgresql://saas_platform:saas_platform@localhost:5432/saas_skeleton';

/**
 * УВАГА: інжектиться ТІЛЬКИ явно і тільки в системний код (maintenance-хендлери,
 * platform-api). Поява SystemPrismaService у доменному модулі = обхід ізоляції = запах.
 */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      max: poolMax(),
      connectionString: process.env.PLATFORM_DATABASE_URL ?? DEFAULT_PLATFORM_DATABASE_URL,
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
