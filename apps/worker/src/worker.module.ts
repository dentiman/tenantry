import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule, TenancyModule } from '@saas-skeleton/database';
import { ActivitiesModule, JobsModule, StorageModule } from '@saas-skeleton/shared';
import { loggerConfig } from './logger.config';
import { CleanupExpiredTokensHandler } from './handlers/cleanup-expired-tokens.handler';
import { CleanupOrphanFilesHandler } from './handlers/cleanup-orphan-files.handler';
import { GenerateThumbnailHandler } from './handlers/generate-thumbnail.handler';
import { UserRegisteredHandler } from './handlers/user-registered.handler';
import { WelcomeEmailHandler } from './handlers/welcome-email.handler';
import { MailerService } from './mail/mailer.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    LoggerModule.forRootAsync(loggerConfig),
    // MT: без резолвера — tenantId приходить у payload джоби (JobWorkerRegistrar піднімає CLS)
    TenancyModule.forRoot(),
    PrismaModule,
    JobsModule.forWorker(),
    StorageModule,
    ActivitiesModule,
  ],
  providers: [
    CleanupExpiredTokensHandler,
    CleanupOrphanFilesHandler,
    GenerateThumbnailHandler,
    UserRegisteredHandler,
    WelcomeEmailHandler,
    MailerService,
  ],
})
export class WorkerModule {}
