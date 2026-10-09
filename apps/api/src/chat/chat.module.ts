import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatRealtime } from './chat-realtime';
import { ChatService } from './chat.service';
import { ConversationAccessService } from './conversation-access.service';
import { DefaultChannelService } from './default-channel.service';

@Module({
  // UsersModule — лише заради UserLifecycleHooks: новий юзер вступає в дефолтний
  // канал у ТІЙ САМІЙ транзакції, що й створюється (design.md D3). Напрямок
  // chat → users, не навпаки (docs/modules.md).
  // RealtimeModule — за `RealtimeEmitter` (живі зміни в особисті room-и учасників);
  // той самий напрямок вниз, що в calendar і ai
  imports: [UsersModule, RealtimeModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRealtime, ConversationAccessService, DefaultChannelService],
})
export class ChatModule {}
