import { createHash } from 'node:crypto';
import type { AiConfig } from '../ai.config';
import { resolveGenerationSettings } from '../platform/platform-ai-settings';
import type { PlatformAiSettingsReader } from '../platform/platform-ai-settings.reader';
import { loadMasterKey } from '../platform/secret-box';
import type { EmbeddingBatch, EmbeddingProvider } from './embedding-provider';
import {
  EmbeddingRequestError,
  OpenAiEmbeddingProvider,
  embeddingProviderFromEnv,
} from './openai-embedding-provider';

/**
 * Embeddings для чату (AI-5a, design.md D5). Окрема пара `AI_EMBEDDING_*` в env має
 * пріоритет; без неї — URL і ключ генерації з налаштувань суперадміна поверх env.
 * Облікових даних немає або хост не підтримується — помилка конкретного питання
 * (`embedding-not-configured`), а не падіння воркера на старті.
 */
export class RuntimeEmbeddingProvider implements EmbeddingProvider {
  private readonly dedicated: OpenAiEmbeddingProvider | null;
  private readonly masterKey: Buffer | null;
  private built: {
    readonly fingerprint: string;
    readonly provider: OpenAiEmbeddingProvider;
  } | null = null;

  constructor(
    private readonly config: AiConfig,
    private readonly settings: Pick<PlatformAiSettingsReader, 'read'>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    const dedicatedPair = [env.AI_EMBEDDING_BASE_URL, env.AI_EMBEDDING_API_KEY].some(Boolean);
    this.dedicated = dedicatedPair ? embeddingProviderFromEnv(env) : null;
    this.masterKey = loadMasterKey(env);
  }

  async embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch> {
    return (this.dedicated ?? (await this.fromGeneration())).embed(texts, signal);
  }

  private async fromGeneration(): Promise<OpenAiEmbeddingProvider> {
    const effective = resolveGenerationSettings(
      await this.settings.read(),
      this.config,
      this.masterKey,
    );
    if (!effective.baseUrl || !effective.apiKey) {
      throw new EmbeddingRequestError('embedding-not-configured');
    }
    const fingerprint = createHash('sha256')
      .update(`${effective.baseUrl}\u0000${effective.apiKey}`)
      .digest('hex');
    if (this.built?.fingerprint !== fingerprint) {
      const provider = embeddingProviderFromEnv({
        ...this.env,
        AI_EMBEDDING_BASE_URL: undefined,
        AI_EMBEDDING_API_KEY: undefined,
        AI_BASE_URL: effective.baseUrl,
        AI_API_KEY: effective.apiKey,
      });
      if (!provider) throw new EmbeddingRequestError('embedding-not-configured');
      this.built = { fingerprint, provider };
    }
    return this.built.provider;
  }
}
