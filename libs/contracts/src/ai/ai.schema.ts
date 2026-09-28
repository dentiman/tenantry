import { z } from 'zod';

/**
 * Контракти AI-асистента (docs/ai-assistant-plan.md, фаза AI-0).
 *
 * Суб'єкт усюди береться з токена, тому в шляхах немає ні id юзера, ні id розмови —
 * та сама доктрина, що в `/account` і `/settings`: відсутність id і Є твердженням
 * «чужа розмова через цей ендпоінт недосяжна», і воно не залежить від уважності
 * в сервісі.
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
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

/**
 * Активна розмова зі стрічкою. Це і є ДЖЕРЕЛО ПРАВДИ для клієнта: socket-дельти
 * лише прискорюють рендер, а при дірці в `chunkSeq` або реконекті клієнт
 * перечитує саме цю відповідь (docs/realtime.md, правило «подія — не доставка»).
 */
export const AiConversationResponseSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable(),
  messages: z.array(AiMessageResponseSchema),
});

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
