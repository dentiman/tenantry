import { z } from 'zod';

/**
 * Конфіг AI-асистента. Читається і в `apps/api` (прапорець + межі), і в
 * `apps/worker` (усе інше) — тому живе в `libs/shared`, а не в апці.
 *
 * `AI_MAX_INPUT_CHARS` тут свідомо НЕМАЄ: стеля довжини питання запікається в
 * Zod-схему контракту, у `createZodDto` і в OpenAPI-документ, тож конфігурована
 * вона означала б, що ці троє можуть розійтися. Це константа
 * `AI_MAX_INPUT_CHARS` із `@saas-skeleton/contracts`.
 */

const boolFromEnv = (fallback: boolean): z.ZodType<boolean, string | undefined> =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value === 'true'));

const intFromEnv = (fallback: number): z.ZodType<number, string | undefined> =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().positive());

/**
 * `fake` — ЄДИНЕ легальне значення у AI-0. Невідоме значення валить старт, а не
 * тихо відкочується на фейк: інсталяція, яка думає, що говорить із реальною
 * моделлю, і насправді віддає канований текст, — гірша за процес, що не піднявся.
 */
const AiProviderSchema = z.enum(['fake']);

const AiEnvSchema = z.object({
  /** Дефолт `false`: скелетон без провайдера не має показувати напівробочого асистента */
  AI_ENABLED: boolFromEnv(false),
  AI_PROVIDER: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? 'fake' : value))
    .pipe(AiProviderSchema),
  /** Стеля вартості ОДНОГО ходу */
  AI_MAX_OUTPUT_TOKENS: intFromEnv(1024),
  /** Скільки минулих ходів їде в промпт (решта лишається в БД, але не в контексті) */
  AI_HISTORY_TURNS: intFromEnv(10),
  AI_REQUEST_TIMEOUT_MS: intFromEnv(60_000),
  /**
   * Коалесування дельт. НЕ токен-за-токеном: 500 кадрів на відповідь винесли б
   * `maxLen: 10_000` Valkey-стріму двадцятьма паралельними генераціями разом із
   * presence і сповіщеннями (docs/ai-assistant-plan.md §4.3).
   */
  AI_STREAM_FLUSH_MS: intFromEnv(120),
  /**
   * Як часто скидати накопичений текст у БД під час генерації. Саме це робить
   * правдивими «частковий вивід переживає обрив» і «reconnect посеред генерації»:
   * перезавантажена сторінка читає стрічку і бачить згенероване досі.
   */
  AI_PARTIAL_PERSIST_MS: intFromEnv(2_000),
  /** Модель. У AI-0 їде лише в лог і в колонку `ai_messages.model` */
  AI_MODEL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? 'fake-1' : value)),
});

export interface AiConfig {
  enabled: boolean;
  provider: z.infer<typeof AiProviderSchema>;
  maxOutputTokens: number;
  historyTurns: number;
  requestTimeoutMs: number;
  streamFlushMs: number;
  partialPersistMs: number;
  model: string;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsed = AiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid AI configuration — ${issues}`);
  }
  const e = parsed.data;
  return {
    enabled: e.AI_ENABLED,
    provider: e.AI_PROVIDER,
    maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
    historyTurns: e.AI_HISTORY_TURNS,
    requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
    streamFlushMs: e.AI_STREAM_FLUSH_MS,
    partialPersistMs: e.AI_PARTIAL_PERSIST_MS,
    model: e.AI_MODEL,
  };
}

export const AI_CONFIG = Symbol('AI_CONFIG');
