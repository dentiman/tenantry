import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationAccessService } from './conversation-access.service';
import { DefaultChannelService } from './default-channel.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ConversationAccessService, DefaultChannelService],
  // DefaultChannelService — для users.service: новий юзер вступає в дефолтний
  // канал у ТІЙ САМІЙ транзакції, що й створюється (design.md D3)
  exports: [DefaultChannelService],
})
export class ChatModule {}
