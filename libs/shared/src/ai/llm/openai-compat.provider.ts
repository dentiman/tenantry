import { Logger, type LoggerService } from '@nestjs/common';
import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from 'openai';
import { decimalString } from '../costs/money';
import {
  LlmProviderError,
  type LlmChunk,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage,
} from './llm-provider';

/**
 * Перший реальний провайдер (ai-1a, docs/ai-assistant.md §5.2, §10.1): будь-який бекенд,
 * для якого форма Chat Completions — РІДНА (OpenRouter, DeepSeek, Groq, xAI, MiniMax…).
 * Різні бекенди — різний конфіг (`baseUrl`/`apiKey`/`model`) того самого класу.
 *
 * Ключові рішення (design.md ai-1a, перенесено в docs/ai-assistant-implementation.md):
 *  - `maxRetries: 0` — у системі РІВНО один цикл ретраю, воркерний (AI-0.1). Власні
 *    ретраї SDK перетворили б одну «спробу» на до трьох HTTP-запитів поза бюджетом
 *    AiLeaseGuard і поза лічильником `attempt` протоколу дельт.
 *  - `signal` воркера йде в запит: Stop і таймаут рвуть HTTP-зʼєднання, а бекенд
 *    перестає генерувати (і рахувати) токени.
 *  - На abort провайдер ТИХО повертається: CANCELLED/TIMEOUT воркер виводить із
 *    причини abort, а будь-яка кинута не-провайдерна помилка стала б `INTERNAL`.
 *  - Кожна помилка назовні — `LlmProviderError` з `retryable` (таблиця в
 *    `classifyOpenAiCompatError`) і, для 429/503, `retryAfterMs`.
 */

export interface OpenAiCompatOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Стеля часу на HTTP-запит; воркер однаково рве його власним таймаутом */
  readonly requestTimeoutMs: number;
  /** Для тестів; дефолт — Nest `Logger` з контекстом класу */
  readonly logger?: Pick<LoggerService, 'log' | 'warn'>;
}

/** HTTP-статуси, повтор яких має сенс: тимчасова відмова, а не «ці байти неправильні» */
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

export class OpenAiCompatProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(options: OpenAiCompatOptions) {
    const logger = options.logger ?? new Logger(OpenAiCompatProvider.name);
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.requestTimeoutMs,
    });

    // Лише хост — ні ключа, ні шляху з можливими токенами в query
    const host = new URL(options.baseUrl).hostname;
    logger.log(`AI provider: openai-compat, host ${host}`);
    if (isAnthropicHost(host)) {
      logger.warn(
        `AI_BASE_URL points at ${host}: Claude models through the OpenAI compatibility layer ` +
          'silently lose prompt caching (~50x cost per turn, no error). Use a native provider ' +
          'instead — see docs/ai-assistant.md §5.3',
      );
    }
  }

  async *generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: request.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          // `max_tokens`, а не `max_completion_tokens`: друге — лише first-party OpenAI,
          // перше розуміють усі сумісні бекенди й OpenRouter
          max_tokens: request.maxOutputTokens,
          // Лише суддя eval (AI-5c): прод температуру не задає, і ключа в тілі немає зовсім
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );
    } catch (error) {
      if (signal.aborted || error instanceof APIUserAbortError) {
        return;
      }
      throw classifyOpenAiCompatError(error);
    }

    let finished = false;
    let finishReason: string | undefined;
    let usage: LlmUsage | undefined;
    let requestId: string | undefined;
    try {
      for await (const chunk of stream) {
        // Id запиту — першим, ще до тексту (AI-5b, design.md R4): спроба, яку зупинять до
        // usage-кадру, теж мусить лишити в журналі ключ для добору вартості
        if (requestId === undefined && typeof chunk.id === 'string' && chunk.id !== '') {
          requestId = chunk.id;
          yield { text: '', requestId };
        }
        const choice = chunk.choices[0];
        if (choice?.finish_reason) {
          // `length` (стеля max_tokens) і `content_filter` — теж ЗАВЕРШЕНА відповідь:
          // стеля виводу задумана, текст до неї лишається
          finished = true;
          finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
          usage = toUsage(chunk.usage, chunk.model);
        }
        const text = choice?.delta.content;
        if (text) {
          yield { text };
        }
      }
    } catch (error) {
      if (signal.aborted || error instanceof APIUserAbortError) {
        return;
      }
      // Обрив тіла посеред стріму (`TypeError: terminated`, ECONNRESET) — не APIError,
      // але саме та тимчасова відмова, після якої ретрай із нуля має сенс
      throw classifyOpenAiCompatError(error);
    }

    if (signal.aborted) {
      // SDK закінчує ітерацію тихо, якщо abort стався посеред тіла
      return;
    }
    // Завершеною відповідь робить `finish_reason` АБО usage-кадр: деякі бекенди не
    // шлють finish_reason на останньому кадрі, а usage приходить лише ПІСЛЯ генерації
    // (ми завжди просимо include_usage). Ні того, ні іншого — обрізаний стрім, і він
    // не має права стати COMPLETE (design.md D3)
    if (!finished && !usage) {
      throw new LlmProviderError('OpenAI-compatible backend stream ended prematurely', {
        retryable: true,
      });
    }
    if (usage) {
      yield { text: '', usage, ...(finishReason !== undefined ? { finishReason } : {}) };
    }
  }
}

/**
 * Usage-кадр → `LlmUsage`. Поля OpenRouter (`cost`, `cache_write_tokens`) тип SDK не знає,
 * тож вони читаються ЗАХИЩЕНО з сирого об'єкта: не те число — поля просто немає (AI-5b).
 */
export function toUsage(
  usage: OpenAI.Completions.CompletionUsage,
  model: string | undefined,
): LlmUsage {
  const raw = usage as unknown as Record<string, unknown>;
  const promptDetails = asRecord(raw.prompt_tokens_details);
  const completionDetails = asRecord(raw.completion_tokens_details);
  const cached = tokenCount(promptDetails?.cached_tokens);
  const cacheWrite = tokenCount(promptDetails?.cache_write_tokens);
  const reasoning = tokenCount(completionDetails?.reasoning_tokens);
  const cost = decimalString(raw.cost);
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    ...(model ? { model } : {}),
    ...(cached !== undefined ? { cachedPromptTokens: cached } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    ...(cost !== undefined ? { reportedCost: cost } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Таблиця класифікації (design.md D3). «Будь-який інший 4xx → false» — безпечний
 * дефолт: хибний `false` коштує одну FAILED-відповідь, хибний `true` — гроші.
 * Повідомлення діагностичне і НЕ містить ні ключа, ні тіла запиту.
 */
export function classifyOpenAiCompatError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) {
    return error;
  }
  if (error instanceof APIConnectionError) {
    // Включно з APIConnectionTimeoutError: DNS, refused, TLS, таймаут зʼєднання
    return new LlmProviderError('OpenAI-compatible backend is unreachable', {
      cause: error,
      retryable: true,
    });
  }
  if (isApiError(error)) {
    const status = error.status;
    if (status === undefined) {
      // Кадр `{"error": …}` посеред 200-стріму (OpenRouter так повідомляє про збій
      // апстріму після початку відповіді) — тимчасова відмова
      return new LlmProviderError('OpenAI-compatible backend reported an error mid-stream', {
        cause: error,
        retryable: true,
      });
    }
    const retryable = RETRYABLE_STATUSES.has(status) || status >= 500;
    const retryAfterMs = retryable ? parseRetryAfter(error.headers) : undefined;
    return new LlmProviderError(`OpenAI-compatible backend responded ${String(status)}`, {
      cause: error,
      retryable,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  return new LlmProviderError('OpenAI-compatible backend stream was interrupted', {
    cause: error,
    retryable: true,
  });
}

/**
 * `instanceof` на generic-класі звужує до `APIError<any, any, any>`; предикат повертає
 * дефолтні параметри (`status: number | undefined`, `headers: Headers | undefined`)
 */
function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

/**
 * `retry-after-ms` (нестандартний, шлють OpenAI і частина сумісних) має пріоритет;
 * далі `Retry-After` — секунди або HTTP-дата. Непарсабельне значення ігнорується.
 */
export function parseRetryAfter(
  headers: Headers | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!headers) {
    return undefined;
  }
  const ms = headers.get('retry-after-ms');
  if (ms !== null && ms.trim() !== '') {
    const value = Number(ms);
    if (Number.isFinite(value) && value >= 0) {
      return Math.ceil(value);
    }
  }
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(raw);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - now);
}

export function isAnthropicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'anthropic.com' || host.endsWith('.anthropic.com');
}
