/**
 * Шов провайдера LLM (docs/ai-assistant-plan.md §9, фаза AI-0).
 *
 * Реалізації: `FakeLlmProvider` (дефолт, CI) і `OpenAiCompatProvider` (ai-1a). Життєвий
 * цикл воркера, протокол дельт і модель даних від вибору реалізації не залежать.
 */

/** Одне повідомлення у форматі, спільному для всіх OpenAI-сумісних API */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly maxOutputTokens: number;
  /**
   * Лише для LLM-судді eval відповідей (AI-5c, design.md D4): прод її не задає, і тоді
   * ключа `temperature` у тілі запиту НЕМАЄ — бекенд бере власний дефолт, як і раніше
   */
  readonly temperature?: number;
}

/**
 * Облік токенів відповіді (ai-1a, design.md D7). Віддається ОСТАННІМ кадром стріму;
 * воркер пише його у фінальній транзакції в `ai_messages.prompt_tokens`/
 * `completion_tokens`/`model`.
 */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Модель, яку бекенд НАСПРАВДІ використав — роутер може підмінити налаштовану */
  readonly model?: string;
  /**
   * Скільки токенів промпту прочитано з кешу провайдера. Лише в лог — саме так ручний
   * прогін із живим ключем бачить, чи працює кеш; зберігати окремо — це `ai-1d`
   */
  readonly cachedPromptTokens?: number;
  /** Токени запису в кеш (AI-5b): OpenRouter `prompt_tokens_details.cache_write_tokens` */
  readonly cacheWriteTokens?: number;
  /** Токени міркування — уже в `completionTokens`, окремо лише для видимості (AI-5b) */
  readonly reasoningTokens?: number;
  /**
   * Вартість, яку списав провайдер (AI-5b, OpenRouter `usage.cost`), — USD десятковим
   * рядком, щоб гроші ніколи не проходили через float-арифметику. Немає — провайдер не
   * повідомив; тоді журнал бере розрахункову вартість за тарифом
   */
  readonly reportedCost?: string;
}

export interface LlmChunk {
  /** Приріст тексту. Порожній рядок легальний (термінальний кадр із usage) */
  readonly text: string;
  /** Є лише на ОСТАННЬОМУ кадрі, і то не в кожного провайдера */
  readonly usage?: LlmUsage;
  /**
   * Id запиту в провайдера (AI-5b, OpenRouter `gen-…`) — окремим порожнім кадром ОДРАЗУ,
   * щойно відомий: Stop, таймаут чи обрив usage не отримають, а за цим id журнал добере
   * фактичну вартість пізніше (design.md R3/R4)
   */
  readonly requestId?: string;
  /**
   * Чому бекенд зупинився (`stop`, `length`…) — разом з usage на термінальному кадрі (AI-5c:
   * eval відрізняє обрізання лімітом виходу). Воркер його не читає
   */
  readonly finishReason?: string;
}

/**
 * Помилка провайдера, яку воркер перетворює на `errorCode: PROVIDER_UNAVAILABLE`.
 * Окремий клас, а не рядок: воркер мусить відрізняти «провайдер відмовив» від
 * власного багу, який має піти в лог як INTERNAL.
 *
 * `retryable` (AI-0.1, design.md D2) — чи є сенс перезапустити генерацію всередині
 * тієї самої доставки. Дефолт `true`: мережева помилка, 5xx, 429 — типовий випадок
 * тимчасової відмови. `OpenAiCompatProvider` виставляє `false` для auth/валідаційних
 * 4xx, де повтор гарантовано провалиться так само.
 *
 * `retryAfterMs` (ai-1a, design.md D4) — скільки бекенд попросив чекати (`Retry-After`).
 * Воркер не ретраїть раніше, а якщо чекати треба довше за `AI_RETRY_DELAY_MS` — не
 * ретраїть узагалі: бюджет оренди (AiLeaseGuard) довшої паузи не покриває.
 */
export class LlmProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly retryable?: boolean;
      readonly retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.cause = options.cause;
    this.retryable = options.retryable ?? true;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Async-iterable, а не колбек: скасування тоді — просто `AbortSignal`, а
 * «одним шматком» (AI_STREAMING=false в AI-1) — ітерабельність з одного кадру.
 * Тобто обидва режими це ОДИН протокол, а не два.
 */
export interface LlmProvider {
  generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}
