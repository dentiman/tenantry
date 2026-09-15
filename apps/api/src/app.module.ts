import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule, SlugTenantResolver, TenancyModule } from '@saas-skeleton/database';
import {
  ActivitiesModule as SharedActivitiesModule,
  CryptoModule,
  MessagingModule,
  NotificationsModule as SharedNotificationsModule,
  NumberingModule as SharedNumberingModule,
  StorageModule,
} from '@saas-skeleton/shared';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { PasswordResetModule } from './auth/password-reset/password-reset.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { CalendarModule } from './calendar/calendar.module';
import { SettingsModule } from './settings/settings.module';
import { AccountModule } from './account/account.module';
import { FilesModule } from './files/files.module';
import { ActivitiesModule } from './activities/activities.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { AppThrottlerModule } from './common/app-throttler.module';
import { loggerConfig } from './common/logger';
import { validateApiEnv } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      // AUTH-0: невалідний env валить старт, а не проявляється через тиждень
      validate: validateApiEnv,
    }),
    LoggerModule.forRootAsync(loggerConfig),
    // MT: ЄДИНЕ місце, де застосунок знає про мультитенантність (§6 плану).
    // MT-3: SlugTenantResolver — поле `tenant` (slug) у Login → resolve_tenant();
    // порожнє поле → env-fallback (N=1 працює як раніше); MT-4: піддомени
    TenancyModule.forRoot({ resolver: SlugTenantResolver }),
    PrismaModule,
    // AUTH-0: Valkey — спільний ресурс процесу (realtime, presence, throttler)
    RedisModule,
    // AUTH-0: обмеження частоти; сам guard реєструється в AuthModule після JwtAuthGuard
    AppThrottlerModule,
    MessagingModule.forProducer(),
    StorageModule,
    // AUTH-3: шифрує токени одноразових посилань перед publish (payload читає pgboss/Jobs-екран)
    CryptoModule,
    SharedActivitiesModule,
    SharedNotificationsModule,
    SharedNumberingModule,
    AuthModule,
    PasswordResetModule,
    UsersModule,
    CustomersModule,
    CalendarModule,
    SettingsModule,
    AccountModule,
    FilesModule,
    ActivitiesModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
