import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { billingProviderFor } from '../costs/billing';
import { decimalString } from '../costs/money';
import {
  KNOWLEDGE_EMBEDDING_MODEL as MODEL,
  KNOWLEDGE_EMBEDDING_DIMENSIONS as DIMENSIONS,
  serializeKnowledgeVector,
  type EmbeddingBatch,
  type EmbeddingBilling,
  type EmbeddingProvider,
} from './embedding-provider';

const ResponseSchema = z.object({
  // AI-5b: id запиту (`embd-…` / `gen-…`) і вартість — захищено, без них відповідь валідна
  id: z.string().optional().catch(undefined),
  model: z.string(),
  data: z.array(
    z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) }),
  ),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    cost: z.unknown().optional(),
  }),
});
export interface EmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
}

/** No raw provider errors, bodies, prompts or credentials are logged. */
export class EmbeddingRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly endpoint: string;
  private readonly requestModel: string;
  private readonly billingProvider: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly options: EmbeddingOptions,
    private readonly request: typeof fetch = fetch,
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['api.openai.com', 'openrouter.ai'].includes(url.hostname) ||
      !options.apiKey.trim()
    )
      throw new Error('Embeddings require an OpenAI/OpenRouter HTTPS base URL and API key');
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
    this.requestModel = url.hostname === 'openrouter.ai' ? `openai/${MODEL}` : MODEL;
    this.billingProvider = billingProviderFor('openai-compat', options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.retries = options.retries ?? 2;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 120_000 ||
      !Number.isInteger(this.retries) ||
      this.retries < 0 ||
      this.retries > 3
    )
      throw new Error('Invalid embedding timeout/retry configuration');
  }

  async embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch> {
    if (!texts.length || texts.length > 128 || texts.some((text) => !text.trim()))
      throw new Error('Embedding batch requires 1–128 nonempty texts');
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      let response: Response;
      let data: unknown;
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const requestSignal = AbortSignal.any([signal, timeout]);
      try {
        response = await this.request(this.endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: requestSignal,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.requestModel,
            dimensions: DIMENSIONS,
            encoding_format: 'float',
            input: texts,
          }),
        });
        if (response.ok) data = await response.json();
      } catch {
        signal.throwIfAborted();
        if (attempt >= this.retries)
          throw new EmbeddingRequestError('embedding-network-or-timeout');
        await delay(500 * 2 ** attempt, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const retryable =
          response.status === 429 || response.status === 408 || response.status >= 500;
        const header = response.headers.get('retry-after');
        const retryAfter =
          header === null
            ? 0
            : /^\d+(\.\d+)?$/.test(header)
              ? Number(header) * 1000
              : Math.max(0, Date.parse(header) - Date.now());
        if (
          !retryable ||
          attempt >= this.retries ||
          !Number.isFinite(retryAfter) ||
          retryAfter > 10_000
        )
          throw new EmbeddingRequestError(`embedding-http-${String(response.status)}`);
        await delay(Math.max(retryAfter, 500 * 2 ** attempt), undefined, { signal });
        continue;
      }
      const parsed = ResponseSchema.safeParse(data);
      if (
        !parsed.success ||
        ![MODEL, this.requestModel].includes(parsed.data.model) ||
        parsed.data.data.length !== texts.length
      )
        throw new EmbeddingRequestError('embedding-invalid-response');
      const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
      try {
        for (const [index, row] of ordered.entries()) {
          if (row.index !== index) throw new Error('Invalid index');
          serializeKnowledgeVector(MODEL, row.embedding);
        }
      } catch {
        throw new EmbeddingRequestError('embedding-invalid-vector');
      }
      return {
        model: MODEL,
        vectors: ordered.map((row) => row.embedding),
        inputTokens: parsed.data.usage.prompt_tokens,
        billing: this.billing(parsed.data),
      };
    }
  }

  private billing(response: z.infer<typeof ResponseSchema>): EmbeddingBilling {
    const cost = decimalString(response.usage.cost);
    return {
      provider: this.billingProvider,
      // Модель для тарифу — як назвав провайдер; OpenRouter ціни ключує `openai/…`
      model: response.model === MODEL ? this.requestModel : response.model,
      ...(cost !== undefined ? { reportedCost: cost } : {}),
      ...(response.id ? { requestId: response.id } : {}),
    };
  }
}

/**
 * Embedding-провайдер з оточення — для операторського CLI і воркера (AI-2a.3). Окремий
 * endpoint задається ПАРОЮ `AI_EMBEDDING_BASE_URL`/`AI_EMBEDDING_API_KEY`; без неї —
 * `AI_BASE_URL`/`AI_API_KEY` генерації. `null`, коли облікових даних немає зовсім.
 */
export function embeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiEmbeddingProvider | null {
  // A separately configured endpoint must also provide its own credential.
  // An empty value counts as unset, hence `some(Boolean)` rather than `??`.
  const dedicated = [env.AI_EMBEDDING_BASE_URL, env.AI_EMBEDDING_API_KEY].some(Boolean);
  const baseUrl = dedicated ? env.AI_EMBEDDING_BASE_URL : env.AI_BASE_URL;
  const apiKey = dedicated ? env.AI_EMBEDDING_API_KEY : env.AI_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return new OpenAiEmbeddingProvider({
    baseUrl,
    apiKey,
    timeoutMs: Number(env.AI_EMBEDDING_TIMEOUT_MS ?? 45000),
    retries: Number(env.AI_EMBEDDING_RETRIES ?? 2),
  });
}
