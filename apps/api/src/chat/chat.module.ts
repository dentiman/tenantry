import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationAccessService } from './conversation-access.service';
import { DefaultChannelService } from './default-channel.service';

@Module({
  // UsersModule — лише заради UserLifecycleHooks: новий юзер вступає в дефолтний
  // канал у ТІЙ САМІЙ транзакції, що й створюється (design.md D3). Напрямок
  // chat → users, не навпаки (docs/modules.md)
  imports: [UsersModule],
  controllers: [ChatController],
  providers: [ChatService, ConversationAccessService, DefaultChannelService],
})
export class ChatModule {}
