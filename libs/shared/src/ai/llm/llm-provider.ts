/**
 * Шов провайдера LLM (docs/ai-assistant-plan.md §9, фаза AI-0).
 *
 * Це ЄДИНЕ, що фаза AI-1 замінює: `OpenAiCompatProvider` стає другою реалізацією
 * цього ж інтерфейсу, а життєвий цикл воркера, протокол дельт і модель даних
 * лишаються недоторканими.
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
}

/**
 * Облік токенів. У AI-0 не заповнюється — резерв, щоб AI-1 міг віддати сюди
 * дані з usage-кадру провайдера, не чіпаючи ні інтерфейс, ні воркер.
 */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface LlmChunk {
  /** Приріст тексту. Порожній рядок легальний (термінальний кадр із usage) */
  readonly text: string;
  /** Є лише на ОСТАННЬОМУ кадрі, і то не в кожного провайдера */
  readonly usage?: LlmUsage;
}

/**
 * Помилка провайдера, яку воркер перетворює на `errorCode: PROVIDER_UNAVAILABLE`.
 * Окремий клас, а не рядок: воркер мусить відрізняти «провайдер відмовив» від
 * власного багу, який має піти в лог як INTERNAL.
 */
export class LlmProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LlmProviderError';
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

/** DI-токен: інтерфейс не існує в рантаймі, класом інжектити не можна */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
