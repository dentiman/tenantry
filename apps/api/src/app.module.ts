import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule, SlugTenantResolver, TenancyModule } from '@saas-skeleton/database';
import { JobsModule, StorageModule } from '@saas-skeleton/shared';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { loggerConfig } from './common/logger';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    LoggerModule.forRootAsync(loggerConfig),
    // MT: ЄДИНЕ місце, де застосунок знає про мультитенантність (§6 плану).
    // MT-3: SlugTenantResolver — поле `tenant` (slug) у Login → resolve_tenant();
    // порожнє поле → env-fallback (N=1 працює як раніше); MT-4: піддомени
    TenancyModule.forRoot({ resolver: SlugTenantResolver }),
    PrismaModule,
    JobsModule.forApi(),
    StorageModule,
    AuthModule,
    UsersModule,
    FilesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
