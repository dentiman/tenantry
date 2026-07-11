import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@saas-skeleton/database';
import { JobsModule } from '@saas-skeleton/shared';
import { loggerConfig } from './logger.config';
import { CleanupExpiredTokensHandler } from './handlers/cleanup-expired-tokens.handler';
import { UserRegisteredHandler } from './handlers/user-registered.handler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    LoggerModule.forRootAsync(loggerConfig),
    PrismaModule,
    JobsModule.forWorker(),
  ],
  providers: [CleanupExpiredTokensHandler, UserRegisteredHandler],
})
export class WorkerModule {}
