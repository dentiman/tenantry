import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule, TenancyModule } from '@saas-skeleton/database';
import {
  ActivitiesModule,
  AiLlmModule,
  AiModule,
  CryptoModule,
  MessagingModule,
  NotificationsModule,
  StorageModule,
} from '@saas-skeleton/shared';
import { loggerConfig } from './logger.config';
import { validateWorkerEnv } from './config/env.schema';
import { AiLeaseGuard } from './ai/ai-lease.guard';
import { AiGenerateReplySubscriber } from './subscribers/ai-generate-reply.subscriber';
import { CleanupExpiredTokensSubscriber } from './subscribers/cleanup-expired-tokens.subscriber';
import { CleanupOrphanFilesSubscriber } from './subscribers/cleanup-orphan-files.subscriber';
import { CleanupProcessedJobsSubscriber } from './subscribers/cleanup-processed-jobs.subscriber';
import { DispatchScheduledNotificationsSubscriber } from './subscribers/dispatch-scheduled-notifications.subscriber';
import { GenerateThumbnailSubscriber } from './subscribers/generate-thumbnail.subscriber';
import { WelcomeEmailSubscriber } from './subscribers/welcome-email.subscriber';
import { PasswordResetEmailSubscriber } from './subscribers/password-reset-email.subscriber';
import { EmailChangeEmailSubscriber } from './subscribers/email-change-email.subscriber';
import { EmailChangedNoticeSubscriber } from './subscribers/email-changed-notice.subscriber';
import { MailerService } from './mail/mailer.service';
import { WorkerRealtimeEmitter } from './realtime/worker-realtime.emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      // AUTH-3: без валідного ENCRYPTION_KEY воркер не розшифрує жоден токен у payload
      validate: validateWorkerEnv,
    }),
    LoggerModule.forRootAsync(loggerConfig),
    // MT: без резолвера — tenantId приходить у конверті (MessageWorkerRegistrar піднімає CLS)
    TenancyModule.forRoot(),
    PrismaModule,
    MessagingModule.forWorker(),
    StorageModule,
    CryptoModule,
    ActivitiesModule,
    NotificationsModule,
    AiModule,
    // ai-1a: провайдер LLM (і його ключ) — лише тут, api його не будує (design.md D5)
    AiLlmModule,
  ],
  providers: [
    WorkerRealtimeEmitter,
    AiLeaseGuard,
    AiGenerateReplySubscriber,
    CleanupExpiredTokensSubscriber,
    CleanupOrphanFilesSubscriber,
    CleanupProcessedJobsSubscriber,
    DispatchScheduledNotificationsSubscriber,
    GenerateThumbnailSubscriber,
    WelcomeEmailSubscriber,
    PasswordResetEmailSubscriber,
    EmailChangeEmailSubscriber,
    EmailChangedNoticeSubscriber,
    MailerService,
  ],
})
export class WorkerModule {}
