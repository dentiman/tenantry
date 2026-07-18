import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
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
