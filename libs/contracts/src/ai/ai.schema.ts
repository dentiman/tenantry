import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';

/**
 * Контракти AI-асистента (docs/ai-assistant-plan.md, фаза AI-0).
 *
 * Суб'єкт усюди береться з токена, тому в шляхах немає id юзера. Поточна розмова
 * (`/ai/conversation…`) адресується без id — та сама доктрина, що в `/account` і
 * `/settings`. Id розмови з'являється лише в історії (`/ai/conversations/:id`), і там
 * чужа або неіснуюча розмова однаково дає 404 — межу людини тримає сервіс.
 */

/**
 * Стеля довжини питання. КОНСТАНТА КОНТРАКТУ, а не env: це значення запікається
 * в Zod-схему, у згенерований `createZodDto` і в опублікований OpenAPI-документ —
 * читання з оточення означало б, що ці троє можуть розійтися між собою.
 */
export const AI_MAX_INPUT_CHARS = 4000;

export const AiMessageRoleSchema = z.enum(['USER', 'ASSISTANT']);

export const AiMessageStatusSchema = z.enum([
  /** Відповідь створена, генерація ще не почалась (job у черзі) */
  'PENDING',
  /** Генерація триває; `content` уже не порожній, але ще не остаточний */
  'STREAMING',
  'COMPLETE',
  'FAILED',
  /** Зупинено користувачем. НЕ помилка: часткова відповідь лишається і показується */
  'CANCELLED',
]);

/**
 * Причина, чому генерація впала. Доменний словник, а НЕ `ApiErrorCode`: це не
 * HTTP-конверт, а факт, збережений у рядку відповіді й намальований у панелі.
 * `ApiErrorCodeSchema` свідомо лишається закритим HTTP-рівневим набором
 * (docs/error-handling.md §1), і доменні коди в нього не додаються.
 */
export const AiMessageErrorCodeSchema = z.enum([
  /** Провайдер недоступний або відмовив */
  'PROVIDER_UNAVAILABLE',
  /** Перевищено `AI_REQUEST_TIMEOUT_MS` */
  'TIMEOUT',
  /** Усе інше — деталі лише в логах, за `requestId` */
  'INTERNAL',
]);

/**
 * Перевірене джерело відповіді (AI-2a.3, design.md D7): фрагмент документації, який
 * сервер справді надав моделі для ЦІЄЇ відповіді І на який текст посилається `[n]`.
 * Лише метадані — текст віддає окремий ендпоінт, що перевіряє доступ заново.
 */
export const AiCitationSchema = z.object({
  /** Номер, під яким фрагмент цитується в тексті відповіді: `[n]` */
  n: z.number().int().positive(),
  title: z.string(),
  /** Розділ документа (breadcrumb заголовків) */
  heading: z.string(),
  /** Шлях документа в джерелі — підпис для людини, а не URL */
  path: z.string(),
});

export const AiMessageResponseSchema = z.object({
  id: z.uuid(),
  /**
   * Серверний порядок у межах розмови. Клієнт сортує по ньому, а не по `createdAt`:
   * мітка часу не дає ні курсора, ні детектора дірок (docs/chat.md §4.3).
   */
  seq: z.number().int().nonnegative(),
  role: AiMessageRoleSchema,
  status: AiMessageStatusSchema,
  /** Для відповіді в роботі — те, що згенеровано на цей момент */
  content: z.string(),
  errorCode: AiMessageErrorCodeSchema.nullable(),
  /**
   * Номер спроби генерації (AI-0.1, design.md D1/D6). Зростає на кожен перезапуск
   * (ретрай або повторне захоплення покинутої відповіді) — той самий фенсинг-токен,
   * що й `ai.message-delta.v1.attempt`: клієнт звіряє їх, щоб знати, чи дельта
   * належить чинній спробі, чи застарілій.
   */
  attempt: z.number().int().nonnegative(),
  /**
   * Скільки дельт-кадрів уже увійшло в `content` цієї спроби. Разом з `attempt` —
   * точка, з якої клієнт продовжує застосовувати живі дельти після ОДНОГО
   * перечитування стрічки, не перечитуючи вдруге (design.md D6).
   */
  chunkCount: z.number().int().nonnegative(),
  /** Порожній для питань, статичного корпусу й відповіді без посилань */
  citations: z.array(AiCitationSchema),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

/**
 * `ACTIVE` — та, куди йде наступне питання (рівно одна на юзера, частковий унікальний
 * індекс); `RETIRED` — минула, лише для читання, доки її не активують знову.
 */
export const AiConversationStatusSchema = z.enum(['ACTIVE', 'RETIRED']);

/**
 * Активна розмова зі стрічкою. Це і є ДЖЕРЕЛО ПРАВДИ для клієнта: socket-дельти
 * лише прискорюють рендер, а при дірці в `chunkSeq` або реконекті клієнт
 * перечитує саме цю відповідь (docs/realtime.md, правило «подія — не доставка»).
 */
export const AiConversationResponseSchema = z.object({
  id: z.uuid(),
  status: AiConversationStatusSchema,
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable(),
  messages: z.array(AiMessageResponseSchema),
});

/** Довжина заголовка розмови в історії — зріз першого питання */
export const AI_CONVERSATION_TITLE_CHARS = 80;

/**
 * Рядок історії розмов (сторінка асистента). Заголовок — зріз ПЕРШОГО питання, а не
 * згенерований моделлю: окремий виклик LLM заради назви коштував би грошей на кожну
 * розмову. Розмови без жодного питання в історію не потрапляють.
 */
export const AiConversationSummarySchema = z.object({
  id: z.uuid(),
  status: AiConversationStatusSchema,
  title: z.string(),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
});

export const AiConversationListQuerySchema = CursorQuerySchema;

export const AiConversationListResponseSchema = cursorResponseSchema(AiConversationSummarySchema);

export const AskAiRequestSchema = z.object({
  text: z.string().trim().min(1).max(AI_MAX_INPUT_CHARS),
});

/**
 * Бізнес-код `FieldError.code` для квоти токенів (ai-1d, design.md D3). НЕ
 * `ApiErrorCode` — той лишається закритим HTTP-рівневим набором (див. коментар
 * до `AiMessageErrorCodeSchema` вище); це той самий ідіом, що `already_exists`/
 * `self_status_change` в users.service.ts: `400 BAD_REQUEST` +
 * `fieldErrors: [{ field: 'text', code: AI_QUOTA_EXCEEDED_CODE }]`. Єдина
 * константа — щоб бекенд і фронт не тримали рядок-літерал у двох місцях.
 */
export const AI_QUOTA_EXCEEDED_CODE = 'ai_quota_exceeded';

/**
 * Відповідь на питання — 202: питання і ПОРОЖНЯ відповідь у статусі `PENDING`.
 * Обидва рядки повертаються одразу, щоб панель намалювала хід ще до того, як
 * воркер узяв job із черги.
 */
export const AskAiResponseSchema = z.object({
  conversationId: z.uuid(),
  question: AiMessageResponseSchema,
  reply: AiMessageResponseSchema,
});

/**
 * Текст цитати (AI-2a.3, design.md D8). Видається власнику відповіді, лише поки фрагмент
 * опублікований і видимий його ПОТОЧНІЙ ролі; інакше 404.
 */
export const AiCitationContentResponseSchema = AiCitationSchema.extend({
  content: z.string(),
});
