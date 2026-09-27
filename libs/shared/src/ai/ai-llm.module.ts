import { Logger, Module, type Provider } from '@nestjs/common';
import { AI_CONFIG, requireProviderCredentials, type AiConfig } from './ai.config';
import { FakeLlmProvider } from './llm/fake-llm.provider';
import { LLM_PROVIDER, LlmProviderError, type LlmChunk, type LlmProvider } from './llm/llm-provider';
import { OpenAiCompatProvider } from './llm/openai-compat.provider';

/**
 * Реєстр провайдерів. `Record` за union-ом, а НЕ `switch`: та сама вичерпність (нове
 * значення в enum `AI_PROVIDER` перестає типізуватись, поки тут не зʼявиться гілка),
 * без тавтологічних порівнянь, які справедливо ловить `no-unnecessary-condition`.
 */
const LLM_FACTORIES: Record<AiConfig['provider'], (config: AiConfig) => LlmProvider> = {
  fake: () => new FakeLlmProvider(),
  'openai-compat': (config) => {
    const credentials = requireProviderCredentials(config);
    if (!credentials) {
      // Вимкнений асистент без облікових даних (design.md D5): піднятись можна, бо
      // питань він не приймає; випадковий job із черги провалює свою відповідь, а
      // не валить воркер
      return new UnconfiguredLlmProvider();
    }
    return new OpenAiCompatProvider({
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  },
};

export function createLlmProvider(config: AiConfig): LlmProvider {
  return LLM_FACTORIES[config.provider](config);
}

class UnconfiguredLlmProvider implements LlmProvider {
  // eslint-disable-next-line require-yield -- провайдер, що лише відмовляє, свідомо не віддає кадрів
  async *generate(): AsyncIterable<LlmChunk> {
    await Promise.resolve();
    throw new LlmProviderError('AI provider is not configured (AI_ENABLED=false)', {
      retryable: false,
    });
  }
}

const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  inject: [AI_CONFIG],
  useFactory: (config: AiConfig): LlmProvider => {
    const provider = createLlmProvider(config);
    new Logger('AiLlmModule').log(`AI provider ${config.provider}, model ${config.model}`);
    return provider;
  },
};

/**
 * Провайдер LLM — ЛИШЕ для воркера (ai-1a, design.md D5). Не глобальний і не частина
 * `AiModule`: api модель не викликає ніколи, тож не має ні будувати провайдер, ні
 * тримати його ключ. `AI_CONFIG` бере з глобального `AiModule`.
 */
@Module({
  providers: [llmProviderFactory],
  exports: [LLM_PROVIDER],
})
export class AiLlmModule {}
