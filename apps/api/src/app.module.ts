import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@saas-skeleton/database';
import { JobsModule, StorageModule } from '@saas-skeleton/shared';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { JobsMonitorModule } from './jobs/jobs.module';
import { loggerConfig } from './common/logger';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    LoggerModule.forRootAsync(loggerConfig),
    PrismaModule,
    JobsModule.forApi(),
    StorageModule,
    AuthModule,
    UsersModule,
    FilesModule,
    JobsMonitorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
