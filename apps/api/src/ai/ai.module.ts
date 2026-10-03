import { Module } from '@nestjs/common';
import { PostgresKnowledgeStore } from '@saas-skeleton/shared';
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
  // Сховище знань — лише для ЧИТАННЯ цитат (AI-2a.3): api моделі й embeddings не викликає
  providers: [AiService, PostgresKnowledgeStore],
})
export class AiModule {}
