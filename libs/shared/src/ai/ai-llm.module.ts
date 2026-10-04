import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { AI_CONFIG, requireProviderCredentials, type AiConfig } from './ai.config';
import { FakeLlmProvider } from './llm/fake-llm.provider';
import { LlmProviderError, type LlmChunk, type LlmProvider } from './llm/llm-provider';
import { OpenAiCompatProvider } from './llm/openai-compat.provider';
import { resolveGenerationSettings } from './platform/platform-ai-settings';
import {
  AiAvailabilityService,
  PlatformAiSettingsReader,
} from './platform/platform-ai-settings.reader';
import { loadMasterKey } from './platform/secret-box';

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

/** Провайдер і модель, якими генерується ОДНА відповідь (AI-5a, design.md D5) */
export interface AiGeneration {
  readonly provider: LlmProvider;
  readonly model: string;
}

/**
 * Те, що воркер питає на кожну генерацію замість синглтона зі старту: чи доступний
 * асистент поточному tenant-у і чим генерувати. Інтерфейс — щоб тест субскрайбера
 * підставляв фейк, не піднімаючи БД.
 */
export interface AiRuntime {
  availableForCurrentTenant(): Promise<boolean>;
  generation(): Promise<AiGeneration>;
}

export const AI_RUNTIME = Symbol('AI_RUNTIME');

/**
 * Налаштування суперадміна поверх env (AI-5a). Провайдер будується заново лише коли
 * змінились провайдер, URL або ключ — відбиток рахується хешем, ключ у пам'яті не
 * порівнюється відкритим текстом і нікуди не логується.
 */
@Injectable()
export class PlatformAiRuntime implements AiRuntime {
  private readonly logger = new Logger(PlatformAiRuntime.name);
  private built: { readonly fingerprint: string; readonly provider: LlmProvider } | null = null;
  // Невалідний AI_SECRETS_KEY валить старт воркера, а не кожну відповідь окремо
  private readonly masterKey = loadMasterKey();

  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    private readonly settings: PlatformAiSettingsReader,
    private readonly availability: AiAvailabilityService,
  ) {}

  async availableForCurrentTenant(): Promise<boolean> {
    return (await this.availability.forCurrentTenant()).available;
  }

  async generation(): Promise<AiGeneration> {
    const effective = resolveGenerationSettings(
      await this.settings.read(),
      this.config,
      this.masterKey,
    );
    const fingerprint = createHash('sha256')
      .update([effective.provider, effective.baseUrl ?? '', effective.apiKey ?? ''].join('\u0000'))
      .digest('hex');
    if (this.built?.fingerprint !== fingerprint) {
      this.built = {
        fingerprint,
        provider: createLlmProvider({
          ...this.config,
          provider: effective.provider,
          baseUrl: effective.baseUrl,
          apiKey: effective.apiKey,
          model: effective.model,
          modelConfigured: effective.modelConfigured,
        }),
      };
      this.logger.log(
        `AI provider ${effective.provider} (source: ${effective.sources.provider}), model ${effective.model} (source: ${effective.sources.model})`,
      );
    }
    return { provider: this.built.provider, model: effective.model };
  }
}

/**
 * Провайдер LLM — ЛИШЕ для воркера (ai-1a, design.md D5). Не глобальний і не частина
 * `AiModule`: api модель не викликає ніколи, тож не має ні будувати провайдер, ні
 * тримати його ключ. З AI-5a провайдер визначається на кожну генерацію (`AI_RUNTIME`)
 * з налаштувань суперадміна поверх env, тож відсутній у env ключ більше не валить старт.
 */
@Module({
  // Читач налаштувань і доступність — з глобального `AiModule` (потрібні й tenant api)
  providers: [PlatformAiRuntime, { provide: AI_RUNTIME, useExisting: PlatformAiRuntime }],
  exports: [AI_RUNTIME],
})
export class AiLlmModule {}
