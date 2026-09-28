import { Global, Module, type Provider } from '@nestjs/common';
import { AI_CONFIG, loadAiConfig, type AiConfig } from './ai.config';
import { AiCancelChannel } from './ai-cancel.channel';
import { AiMessageStateService } from './ai-message-state.service';
import { AiUsageQuotaService } from './ai-usage-quota.service';

const aiConfigProvider: Provider = {
  provide: AI_CONFIG,
  useFactory: (): AiConfig => loadAiConfig(),
};

/**
 * Глобальний, як StorageModule: інфраструктурна залежність і api, і worker-а.
 * Провайдер LLM тут свідомо НЕМАЄ — він лише воркерний, `AiLlmModule` (ai-1a)
 */
@Global()
@Module({
  providers: [aiConfigProvider, AiCancelChannel, AiMessageStateService, AiUsageQuotaService],
  exports: [AI_CONFIG, AiCancelChannel, AiMessageStateService, AiUsageQuotaService],
})
export class AiModule {}
