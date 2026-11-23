import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule, type ClsService } from 'nestjs-cls';
import { SystemPrismaModule } from '@saas-skeleton/database';
import { LOG_CONTEXT, createLoggerConfig } from '@saas-skeleton/shared/logging';
import { HealthController } from './health.controller';
import { PlatformAuthModule } from './auth/platform-auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { ChatOperationsModule } from './chat/chat-operations.module';
import { ChatProvisioningModule } from './chat/chat-provisioning.module';
import { JobsMonitorModule } from './jobs/jobs.module';
import { AiCostsModule } from './ai-costs/ai-costs.module';
import { AiSettingsModule } from './ai-settings/ai-settings.module';
import { RedisModule } from './redis/redis.module';
import { AppThrottlerModule } from './common/app-throttler.module';
import { validatePlatformEnv } from './config/env.schema';

/**
 * CONTROL PLANE (MT-3). Принципово ВІДСУТНІ в графі залежностей:
 * TenancyModule/PrismaModule (tenant-контекст), JobsModule (диспатч у черги),
 * StorageModule. Тут — окрема identity (platform_users), окремий JWT-secret,
 * роль saas_platform (BYPASSRLS): крос-tenant операції живуть ТІЛЬКИ тут.
 *
 * AUTH-2 (R-15): platform-api став другим споживачем throttler-а з `libs/shared` —
 * `RedisModule`/`AppThrottlerModule` тут свої (без realtime-гейтвея), сам guard
 * реєструється в `PlatformAuthModule` після guard-а автентифікації оператора.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      // AUTH-0: невалідний env валить старт, а не проявляється через тиждень
      validate: validatePlatformEnv,
    }),
    LoggerModule.forRootAsync(createLoggerConfig({ service: 'platform-api' })),
    // Контекст запиту для логера (`trace_id`, `user.id` оператора). Tenant-контексту тут
    // немає принципово, тому CLS підключається напряму, а не через TenancyModule. Стоїть
    // ПІСЛЯ LoggerModule: id запиту на той момент уже видав pino-http
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls: ClsService, req: { id?: string | number }): void => {
          if (req.id !== undefined) {
            cls.set(LOG_CONTEXT.traceId, String(req.id));
          }
        },
      },
    }),
    SystemPrismaModule,
    RedisModule,
    AppThrottlerModule,
    PlatformAuthModule,
    TenantsModule,
    // Дефолтний канал чату при появі тенанта (docs/modules.md §7.3)
    ChatProvisioningModule,
    // CHAT-2a: вебхуки каналів без тенанта (невідомий ключ тощо)
    ChatOperationsModule,
    JobsMonitorModule,
    AiSettingsModule,
    // AI-5b: журнал витрат і тарифи
    AiCostsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
