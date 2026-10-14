import { Module } from '@nestjs/common';
import {
  ChannelAdapterRegistry,
  ChannelContactService,
  ChatSharedModule,
  createChannelAdapterRegistry,
} from '@saas-skeleton/shared';
import { CustomersModule } from '../customers/customers.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { ChannelController, MessagingSettingsController } from './channel.controller';
import { ChatDevToolsController } from './chat-dev-tools.controller';
import { ChatDevToolsGuard } from './chat-dev-tools.guard';
import { ChatDevToolsService } from './chat-dev-tools.service';
import { ChannelInboxService } from './channel-inbox.service';
import { ChannelWebhookController } from './channel-webhook.controller';
import { MessagingAccountService } from './messaging-account.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { OutreachService } from './outreach.service';
import { ChannelWebhookService } from './channel-webhook.service';
import { ChatController } from './chat.controller';
import { ChatRealtime } from './chat-realtime';
import { ChatSocketHandlers } from './chat.socket-handlers';
import { ChatService } from './chat.service';
import { CustomerChatService } from './customer-chat.service';
import { ConversationAccessService } from './conversation-access.service';
import { DefaultChannelService } from './default-channel.service';

@Module({
  // UsersModule — лише заради UserLifecycleHooks: новий юзер вступає в дефолтний
  // канал у ТІЙ САМІЙ транзакції, що й створюється (design.md D3). Напрямок
  // chat → users, не навпаки (docs/modules.md).
  // RealtimeModule — за `RealtimeEmitter` (живі зміни в особисті room-и учасників);
  // той самий напрямок вниз, що в calendar і ai
  imports: [UsersModule, RealtimeModule, CustomersModule, ChatSharedModule],
  controllers: [
    ChatController,
    ChannelController,
    MessagingSettingsController,
    ChannelWebhookController,
    ChatDevToolsController,
  ],
  providers: [
    // CHAT-2a: реєстр адаптерів (fake — лише з CHAT_DEV_TOOLS) і публічний вебхук каналів
    {
      provide: ChannelAdapterRegistry,
      useFactory: (): ChannelAdapterRegistry => createChannelAdapterRegistry(),
    },
    ChannelWebhookService,
    ChannelInboxService,
    MessagingAccountService,
    WhatsAppConnectionService,
    OutreachService,
    ChannelContactService,
    ChatDevToolsGuard,
    ChatDevToolsService,
    ChatService,
    CustomerChatService,
    ChatRealtime,
    ChatSocketHandlers,
    ConversationAccessService,
    DefaultChannelService,
  ],
})
export class ChatModule {}
