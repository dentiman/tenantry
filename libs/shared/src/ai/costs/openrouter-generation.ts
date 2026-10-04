import { decimalString } from './money';
import type { LedgerTokens } from './usage-ledger';

/**
 * Запис генерації OpenRouter (AI-5b, design.md D4/R5): фактична вартість і НАТИВНІ токени
 * спроби, яка не отримала usage-кадр (Stop, таймаут, обрив, падіння воркера). Викликається
 * ЛИШЕ поза транзакцією (правило 18).
 */

export type GenerationLookup =
  | {
      readonly status: 'found';
      readonly cost: string;
      readonly model: string | null;
      readonly tokens: LedgerTokens;
    }
  /** Запису ще немає (OpenRouter публікує його із затримкою) або тимчасовий збій — пізніше */
  | { readonly status: 'retry'; readonly reason: string };

const DEFAULT_TIMEOUT_MS = 10_000;

export interface GenerationLookupOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export async function fetchOpenRouterGeneration(
  requestId: string,
  options: GenerationLookupOptions,
): Promise<GenerationLookup> {
  const fetchFn = options.fetch ?? fetch;
  const url = new URL(`${options.baseUrl.replace(/\/+$/, '')}/generation`);
  url.searchParams.set('id', requestId);
  let response: Response;
  try {
    response = await fetchFn(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
    });
  } catch {
    // Без деталей: помилка fetch може містити URL, а ключ — у заголовку, не в тексті
    return { status: 'retry', reason: 'unreachable' };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { status: 'retry', reason: `http-${String(response.status)}` };
  }
  const body: unknown = await response.json().catch(() => null);
  return parseGenerationRecord(body);
}

/** Захищений розбір: невідоме поле — відсутнє значення, а не виняток */
export function parseGenerationRecord(body: unknown): GenerationLookup {
  const data = record(record(body)?.data);
  if (!data) {
    return { status: 'retry', reason: 'invalid-response' };
  }
  const cost = decimalString(data.total_cost);
  if (cost === undefined) {
    return { status: 'retry', reason: 'no-cost' };
  }
  const prompt = count(data.native_tokens_prompt) ?? count(data.tokens_prompt);
  const completion = count(data.native_tokens_completion) ?? count(data.tokens_completion);
  return {
    status: 'found',
    cost,
    model: typeof data.model === 'string' && data.model !== '' ? data.model : null,
    tokens: {
      inputTokens: prompt,
      cachedReadTokens: count(data.native_tokens_cached),
      cacheWriteTokens: count(data.native_tokens_cache_write),
      outputTokens: completion,
      reasoningTokens: count(data.native_tokens_reasoning),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
