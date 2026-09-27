import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/**
 * `AiModule` з `libs/shared` глобальний (конфіг, провайдер, канал скасування,
 * `AiMessageStateService`), тому тут імпортувати нічого не треба заради нього.
 * `RealtimeModule` — за `RealtimeEmitter`: `ai.conversation-changed.v1` в
 * особистий room юзера (AI-0.1, design.md D7).
 */
@Module({
  imports: [RealtimeModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
