import { Module } from '@nestjs/common';
import { PostgresKnowledgeStore } from '@saas-skeleton/shared';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';

/**
 * `AiModule` з `libs/shared` глобальний (конфіг, провайдер, канал скасування,
 * `AiMessageStateService`), тому тут імпортувати нічого не треба заради нього.
 * `RealtimeModule` — за `RealtimeEmitter`: `ai.conversation-changed.v1` в
 * особистий room юзера (AI-0.1, design.md D7). `SettingsModule` — сховище секції
 * `settings.ai` і прапорець `features.ai` у bootstrap: їх реєструє фіча, а не settings
 * (docs/modules.md §4).
 */
@Module({
  imports: [RealtimeModule, SettingsModule],
  controllers: [AiController, AiSettingsController],
  // Сховище знань — лише для ЧИТАННЯ цитат (AI-2a.3): api моделі й embeddings не викликає
  providers: [AiService, AiSettingsService, PostgresKnowledgeStore],
})
export class AiModule {}
