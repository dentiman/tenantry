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

/** Як `intFromEnv`, але 0 — легальне значення (наприклад, "жодного ретраю") */
const nonNegativeIntFromEnv = (fallback: number): z.ZodType<number, string | undefined> =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().nonnegative());

/**
 * `fake` — дефолт і основа CI; `openai-compat` (ai-1a) — будь-який бекенд із рідною
 * формою Chat Completions (OpenRouter, DeepSeek, Groq, xAI, MiniMax…). Невідоме
 * значення валить старт, а не тихо відкочується на фейк: інсталяція, яка думає, що
 * говорить із реальною моделлю, і насправді віддає канований текст, — гірша за процес,
 * що не піднявся. `anthropic` відкладено (docs/ai-assistant.md §5.3).
 */
const AiProviderSchema = z.enum(['fake', 'openai-compat']);

const DEFAULT_FAKE_MODEL = 'fake-1';

/**
 * Звідки воркер бере знання для промпту (AI-2a.3, design.md D1). `static` — закомічений
 * корпус рівня 1, як до AI-2a; `postgres` — retrieval з опублікованого pgvector-індексу
 * ОДНОГО продукту (`AI_KNOWLEDGE_PRODUCT`). Змішування немає: порожній пошук у
 * `postgres` не підтягує статичний корпус іншого продукту.
 */
const AiKnowledgeBackendSchema = z.enum(['static', 'postgres']);

/**
 * Режим retrieval і поріг distance (AI-2a.4, design.md D3/D4). Дефолти обрано за
 * `pnpm ai:docs:eval` на FMS (docs/ai-sources/README.md): hybrid дав найвищий Recall@5 і
 * переживає недоступність embeddings; поріг 0.8 не втратив жодної правильної сторінки
 * (найдальша — 0.769), але відсіяв частину питань без відповіді. Поріг прив'язаний до
 * моделі embeddings — зміна моделі вимагає нового виміру.
 */
const AiDocsSearchModeSchema = z.enum(['vector', 'fts', 'hybrid']);
const DEFAULT_DOCS_SEARCH_MODE = 'hybrid';
const DEFAULT_DOCS_MAX_DISTANCE = 0.8;

/** Порожній рядок у `.env` означає «не задано», як і в решті цього файлу */
const optionalStringFromEnv = (): z.ZodType<string | null, string | undefined> =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value));

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
  /**
   * Модель: ідентифікатор у бекенда (`openai/gpt-5.6-luna` для OpenRouter) і колонка
   * `ai_messages.model`. Дефолт `fake-1` — лише для `fake`: реальному бекенду
   * відправити його як назву моделі було б безглуздо, тому для `openai-compat` змінна
   * обовʼязкова (`requireProviderCredentials`)
   */
  AI_MODEL: optionalStringFromEnv(),
  /**
   * OpenAI-сумісний ендпоінт (ai-1a), напр. `https://openrouter.ai/api/v1`. Без дефолту:
   * мовчки слати промпти юзерів на хост, якого оператор не вибирав, — не варіант
   */
  AI_BASE_URL: optionalStringFromEnv().pipe(z.url({ protocol: /^https?$/ }).nullable()),
  /**
   * Ключ бекенду (ai-1a). Потрібен ЛИШЕ воркеру — api модель не викликає ніколи.
   * Ніколи не логуються ні він, ні `AiConfig` цілком
   */
  AI_API_KEY: optionalStringFromEnv(),
  /**
   * AI-0.1 (docs/ai-assistant-review-gaps.md п.3, design.md D2): скільки РАЗІВ
   * перезапускати генерацію всередині ОДНІЄЇ доставки після тимчасової відмови
   * провайдера, перш ніж визнати відповідь FAILED. 0 — жодного ретраю
   */
  AI_PROVIDER_RETRIES: nonNegativeIntFromEnv(1),
  /** Пауза перед перезапуском (design.md D2). Скасовна: Stop/timeout перериває чекання */
  AI_RETRY_DELAY_MS: intFromEnv(2_000),
  /**
   * Оренда для PENDING-рядка, виставлена одразу при створенні (design.md D3):
   * якщо відповідь так і не була захоплена жодною доставкою до цього строку,
   * вона вважається покинутою і закривається на наступному читанні розмови
   */
  AI_PENDING_TIMEOUT_MS: intFromEnv(300_000),
  /**
   * Період власної перевірки `cancelRequestedAt` під час стріму (design.md D4) —
   * незалежно від кадрів провайдера, тому й мовчазний провайдер таки зупиняється
   */
  AI_CANCEL_CHECK_MS: intFromEnv(2_000),
  /**
   * Скільки днів тримати розмову й повідомлення (ai-1e, docs/ai-assistant.md §9.2):
   * нічний cron `ai.purge-conversations` жорстко видаляє те, що старіше. Читає лише
   * воркер, але живе тут разом з рештою AI-конфігу, а не окремим об'єктом на одне поле
   */
  AI_RETENTION_DAYS: intFromEnv(90),
  /**
   * Квота токенів на КОРИСТУВАЧА за добу UTC (ai-1d, design.md D2/D7). Дефолт від
   * орієнтирів живого прогону (docs/ai-assistant-implementation.md §7.1): ≈11k
   * промпту + ~100 відповіді на хід → ~90 найгірших (холодних) ходів/добу
   */
  AI_QUOTA_USER_DAILY_TOKENS: intFromEnv(1_000_000),
  /**
   * Квота токенів на ТЕНАНТА за ту саму добу (ai-1d, design.md D7) — 10× користувацької,
   * щоб обмежити сумарний розгін багатьма юзерами, кожен у межах власної квоти
   */
  AI_QUOTA_TENANT_DAILY_TOKENS: intFromEnv(10_000_000),
  /**
   * Ліміт ПИТАНЬ на користувача за добу UTC (демо-стенд, docs/demo.md): щоб глядач міг спробувати
   * асистента, а випадковий перебір не спалив бюджет ключа. Окремо від токенних квот: ті міряють
   * вартість і списуються після відповіді, а питання резервується атомарно в `ask()`. `0` — ліміту
   * немає (дефолт; прод-інсталяції керуються лише токенними квотами)
   */
  AI_QUOTA_USER_DAILY_MESSAGES: nonNegativeIntFromEnv(0),
  AI_KNOWLEDGE_BACKEND: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? 'static' : value))
    .pipe(AiKnowledgeBackendSchema),
  /** `product` у `ai_knowledge_sources`; обовʼязковий для `postgres` (перевіряє воркер) */
  AI_KNOWLEDGE_PRODUCT: optionalStringFromEnv(),
  /** Скільки кандидатів віддає vector-пошук до відбору (design.md D2) */
  AI_DOCS_VECTOR_CANDIDATES: intFromEnv(12).pipe(z.number().max(50)),
  /** Стеля фрагментів у промпті */
  AI_DOCS_FINAL_CHUNKS: intFromEnv(5).pipe(z.number().max(20)),
  /** Стеля токенів фрагментів разом із мітками — головна стеля витрат на знання */
  AI_DOCS_MAX_CONTEXT_TOKENS: intFromEnv(2_500).pipe(z.number().max(20_000)),
  AI_DOCS_SEARCH_MODE: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? DEFAULT_DOCS_SEARCH_MODE : value))
    .pipe(AiDocsSearchModeSchema),
  /** Скільки кандидатів віддає FTS-гілка до злиття */
  AI_DOCS_FTS_CANDIDATES: intFromEnv(12).pipe(z.number().max(50)),
  /** Поріг cosine distance vector-гілки (0 < d ≤ 2); `none` — без порогу (design.md D4) */
  AI_DOCS_MAX_DISTANCE: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value === undefined || value === ''
        ? DEFAULT_DOCS_MAX_DISTANCE
        : value === 'none'
          ? null
          : Number(value),
    )
    .pipe(z.number().gt(0).max(2).nullable()),
});

/**
 * Запас над `requestTimeoutMs` для оренди власності генерації (design.md D1).
 * Heartbeat не потрібен: загальний таймаут (разом з ретраями всередині нього, D2)
 * і так обмежує генерацію — живий власник ніколи не переживе власну оренду.
 * Запас поглинає розбіжність годинників API/worker на одному ноді (Risks D1).
 */
export const AI_LEASE_GRACE_MS = 30_000;

export interface AiConfig {
  enabled: boolean;
  provider: z.infer<typeof AiProviderSchema>;
  maxOutputTokens: number;
  historyTurns: number;
  requestTimeoutMs: number;
  streamFlushMs: number;
  partialPersistMs: number;
  model: string;
  /** Чи задано `AI_MODEL` явно — `fake-1` за замовчуванням реальному бекенду не годиться */
  modelConfigured: boolean;
  /** OpenAI-сумісний ендпоінт; `null` — не задано (для `fake` і не треба) */
  baseUrl: string | null;
  /** Ключ бекенду. НІКОЛИ не логувати — ні сам, ні `AiConfig` цілком (design.md D5) */
  apiKey: string | null;
  providerRetries: number;
  retryDelayMs: number;
  pendingTimeoutMs: number;
  cancelCheckMs: number;
  /** requestTimeoutMs + AI_LEASE_GRACE_MS — похідне, не власний env (design.md D1) */
  leaseMs: number;
  /** ai-1e: скільки днів тримати розмову/повідомлення, перш ніж нічний cron їх видалить */
  retentionDays: number;
  /** Квота токенів на користувача за добу UTC (ai-1d, design.md D2/D7) */
  quotaUserDailyTokens: number;
  /** Квота токенів на тенанта за ту саму добу (ai-1d, design.md D7) */
  quotaTenantDailyTokens: number;
  /** Ліміт питань на користувача за добу UTC; `0` — без ліміту */
  quotaUserDailyMessages: number;
  /** AI-2a.3: джерело знань і бюджет retrieval (design.md D1/D2) */
  knowledge: {
    backend: z.infer<typeof AiKnowledgeBackendSchema>;
    product: string | null;
    vectorCandidates: number;
    finalChunks: number;
    maxContextTokens: number;
    mode: z.infer<typeof AiDocsSearchModeSchema>;
    textCandidates: number;
    maxDistance: number | null;
  };
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
    model: e.AI_MODEL ?? DEFAULT_FAKE_MODEL,
    modelConfigured: e.AI_MODEL !== null,
    baseUrl: e.AI_BASE_URL,
    apiKey: e.AI_API_KEY,
    providerRetries: e.AI_PROVIDER_RETRIES,
    retryDelayMs: e.AI_RETRY_DELAY_MS,
    pendingTimeoutMs: e.AI_PENDING_TIMEOUT_MS,
    cancelCheckMs: e.AI_CANCEL_CHECK_MS,
    leaseMs: e.AI_REQUEST_TIMEOUT_MS + AI_LEASE_GRACE_MS,
    retentionDays: e.AI_RETENTION_DAYS,
    quotaUserDailyTokens: e.AI_QUOTA_USER_DAILY_TOKENS,
    quotaTenantDailyTokens: e.AI_QUOTA_TENANT_DAILY_TOKENS,
    quotaUserDailyMessages: e.AI_QUOTA_USER_DAILY_MESSAGES,
    knowledge: {
      backend: e.AI_KNOWLEDGE_BACKEND,
      product: e.AI_KNOWLEDGE_PRODUCT,
      vectorCandidates: e.AI_DOCS_VECTOR_CANDIDATES,
      finalChunks: Math.min(e.AI_DOCS_FINAL_CHUNKS, e.AI_DOCS_VECTOR_CANDIDATES),
      maxContextTokens: e.AI_DOCS_MAX_CONTEXT_TOKENS,
      mode: e.AI_DOCS_SEARCH_MODE,
      textCandidates: e.AI_DOCS_FTS_CANDIDATES,
      maxDistance: e.AI_DOCS_MAX_DISTANCE,
    },
  };
}

export interface ProviderCredentials {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Перевірка облікових даних зовнішнього бекенду (ai-1a, design.md D5). НЕ частина
 * `loadAiConfig()`: той самий конфіг читає api (прапорець, межі), якому ключ не
 * потрібен і не повинен бути виданий. Викликається там, де провайдер БУДУЄТЬСЯ,
 * тобто лише у воркері, — і валить його старт з іменем змінної, як решта цього файлу.
 *
 * Повертає `null`, коли облікові дані не потрібні (`fake`) або асистент вимкнений і їх
 * немає: вимкнений асистент питань не приймає, і відсутній ключ тоді не привід не
 * піднятись.
 */
export function requireProviderCredentials(config: AiConfig): ProviderCredentials | null {
  if (config.provider === 'fake') {
    return null;
  }
  const missing: string[] = [];
  if (config.baseUrl === null) {
    missing.push('AI_BASE_URL');
  }
  if (config.apiKey === null) {
    missing.push('AI_API_KEY');
  }
  if (!config.modelConfigured) {
    missing.push('AI_MODEL');
  }
  if (config.baseUrl === null || config.apiKey === null || !config.modelConfigured) {
    if (!config.enabled) {
      return null;
    }
    throw new Error(
      `Invalid AI configuration — ${missing
        .map((name) => `${name}: required when AI_PROVIDER=${config.provider} and AI_ENABLED=true`)
        .join('; ')}`,
    );
  }
  return { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
}

export const AI_CONFIG = Symbol('AI_CONFIG');
