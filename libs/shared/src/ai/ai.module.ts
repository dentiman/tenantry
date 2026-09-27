import { Global, Module, type Provider } from '@nestjs/common';
import { AI_CONFIG, loadAiConfig, type AiConfig } from './ai.config';
import { AiCancelChannel } from './ai-cancel.channel';
import { AiMessageStateService } from './ai-message-state.service';
import { FakeLlmProvider } from './llm/fake-llm.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm/llm-provider';

/**
 * Реєстр провайдерів. `Record` за union-ом, а НЕ `switch`: він дає ту саму
 * вичерпність (коли `ai-1a` додасть `'openai-compat'` в enum, цей обʼєкт перестане
 * типізуватись, поки не зʼявиться гілка), але без тавтологічного порівняння —
 * на union-і з одного члена `case 'fake'` завжди істинний, і це справедливо
 * ловить `no-unnecessary-condition`.
 */
const LLM_FACTORIES: Record<AiConfig['provider'], () => LlmProvider> = {
  fake: () => new FakeLlmProvider(),
};

const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  inject: [AI_CONFIG],
  useFactory: (config: AiConfig): LlmProvider => LLM_FACTORIES[config.provider](),
};

const aiConfigProvider: Provider = {
  provide: AI_CONFIG,
  useFactory: (): AiConfig => loadAiConfig(),
};

/** Глобальний, як StorageModule: інфраструктурна залежність і api, і worker-а */
@Global()
@Module({
  providers: [aiConfigProvider, llmProviderFactory, AiCancelChannel, AiMessageStateService],
  exports: [AI_CONFIG, LLM_PROVIDER, AiCancelChannel, AiMessageStateService],
})
export class AiModule {}
