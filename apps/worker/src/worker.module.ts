import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule, TenancyModule } from '@saas-skeleton/database';
import { ActivitiesModule, MessagingModule, StorageModule } from '@saas-skeleton/shared';
import { loggerConfig } from './logger.config';
import { CleanupExpiredTokensSubscriber } from './subscribers/cleanup-expired-tokens.subscriber';
import { CleanupOrphanFilesSubscriber } from './subscribers/cleanup-orphan-files.subscriber';
import { CleanupProcessedJobsSubscriber } from './subscribers/cleanup-processed-jobs.subscriber';
import { GenerateThumbnailSubscriber } from './subscribers/generate-thumbnail.subscriber';
import { WelcomeEmailSubscriber } from './subscribers/welcome-email.subscriber';
import { MailerService } from './mail/mailer.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    LoggerModule.forRootAsync(loggerConfig),
    // MT: без резолвера — tenantId приходить у конверті (MessageWorkerRegistrar піднімає CLS)
    TenancyModule.forRoot(),
    PrismaModule,
    MessagingModule.forWorker(),
    StorageModule,
    ActivitiesModule,
  ],
  providers: [
    CleanupExpiredTokensSubscriber,
    CleanupOrphanFilesSubscriber,
    CleanupProcessedJobsSubscriber,
    GenerateThumbnailSubscriber,
    WelcomeEmailSubscriber,
    MailerService,
  ],
})
export class WorkerModule {}
