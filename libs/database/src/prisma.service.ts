import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
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

// MT-0: runtime ходить під saas_app (НЕ власник схеми, без BYPASSRLS — RLS діятиме з MT-2)
const DEFAULT_DATABASE_URL = 'postgresql://saas_app:saas_app@localhost:5432/saas_skeleton';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      max: poolMax(),
      connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
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
