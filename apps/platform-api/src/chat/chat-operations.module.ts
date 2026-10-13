import { Module } from '@nestjs/common';
import { ChannelEventsController } from './channel-events.controller';
import { ChannelEventsService } from './channel-events.service';

/** Операторський погляд на канали чату (CHAT-2a); повний набір (replay, retention) — CHAT-2c */
@Module({
  controllers: [ChannelEventsController],
  providers: [ChannelEventsService],
})
export class ChatOperationsModule {}
