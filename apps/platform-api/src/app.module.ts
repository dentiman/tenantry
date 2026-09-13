import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { SystemPrismaModule } from '@saas-skeleton/database';
import { HealthController } from './health.controller';
import { PlatformAuthModule } from './auth/platform-auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { JobsMonitorModule } from './jobs/jobs.module';
import { loggerConfig } from './logger.config';
import { validatePlatformEnv } from './config/env.schema';

/**
 * CONTROL PLANE (MT-3). Принципово ВІДСУТНІ в графі залежностей:
 * TenancyModule/PrismaModule (tenant-контекст), JobsModule (диспатч у черги),
 * StorageModule. Тут — окрема identity (platform_users), окремий JWT-secret,
 * роль saas_platform (BYPASSRLS): крос-tenant операції живуть ТІЛЬКИ тут.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      // AUTH-0: невалідний env валить старт, а не проявляється через тиждень
      validate: validatePlatformEnv,
    }),
    LoggerModule.forRootAsync(loggerConfig),
    SystemPrismaModule,
    PlatformAuthModule,
    TenantsModule,
    JobsMonitorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
