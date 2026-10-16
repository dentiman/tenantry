import { Global, Module } from '@nestjs/common';
import { SystemPrismaService } from './system-prisma.service';

/**
 * MT-3: клієнт БД із BYPASSRLS — ТІЛЬКИ SystemPrismaService (saas_platform). Свідомо окремий
 * від PrismaModule: той провайдить tenant-extended клієнт і вимагає ClsService (TenancyModule),
 * а platform-api TenancyModule НЕ імпортує взагалі (§6 multi-tenancy-plan.md) — розділення
 * plane-ів має бути видно в графі залежностей.
 *
 * Імпортують: apps/platform-api (control plane) і apps/worker (системні cron-джоби). Tenant API
 * НЕ імпортує — його процес не має отримувати BYPASSRLS-клієнт (ESLint забороняє імпорт у
 * apps/api/src). E2e tenant API додають цей модуль у тестовий модуль для fixture-ів.
 */
@Global()
@Module({
  providers: [SystemPrismaService],
  exports: [SystemPrismaService],
})
export class SystemPrismaModule {}
