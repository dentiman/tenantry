import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MessageContextService } from './message-context.service';
import { MessageCorrelationMiddleware } from './message-correlation.middleware';
import { MessageInboxService } from './message-inbox.service';
import { MessagePublisher } from './message-publisher.service';
import { MessageWorkerRegistrar } from './message-worker.registrar';
import { PgBossService } from './pg-boss.service';

const coreProviders = [PgBossService, MessageContextService, MessagePublisher];

@Module({})
export class MessagingModule implements NestModule {
  /** Продюсери (api, platform-api): публікація без обробки */
  static forProducer(): DynamicModule {
    return {
      module: MessagingModule,
      global: true,
      providers: [...coreProviders, MessageCorrelationMiddleware],
      exports: [MessagePublisher, MessageContextService],
    };
  }

  /** Worker: публікація + обробка (@MessageSubscriber-класи знаходяться автоматично) */
  static forWorker(): DynamicModule {
    return {
      module: MessagingModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [...coreProviders, MessageCorrelationMiddleware, MessageInboxService, MessageWorkerRegistrar],
      exports: [MessagePublisher, MessageContextService, MessageInboxService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // У worker (createApplicationContext, без HTTP) middleware не монтується —
    // там корінь ланцюга приходить у конверті, а не з запиту.
    consumer.apply(MessageCorrelationMiddleware).forRoutes('*');
  }
}
