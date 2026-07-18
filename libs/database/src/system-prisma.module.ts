import { Global, Module } from '@nestjs/common';
import { SystemPrismaService } from './system-prisma.service';

/**
 * MT-3: клієнт БД для CONTROL PLANE (apps/platform-api) — ТІЛЬКИ SystemPrismaService
 * (saas_platform, BYPASSRLS). Свідомо окремий від PrismaModule: той провайдить
 * tenant-extended клієнт і вимагає ClsService (TenancyModule), а platform-api
 * TenancyModule НЕ імпортує взагалі (§6 multi-tenancy-plan.md) — розділення plane-ів
 * має бути видно в графі залежностей.
 */
@Global()
@Module({
  providers: [SystemPrismaService],
  exports: [SystemPrismaService],
})
export class SystemPrismaModule {}
