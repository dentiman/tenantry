import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';

/**
 * Контракти чату (docs/chat.md, фаза CHAT-0.1 — §7.4).
 *
 * Межа фази: тільки INTERNAL-розмови між юзерами тенанта, тільки текст, без
 * realtime. Колонки, яких фаза не використовує (`channel_id`, `direction`,
 * `customer_id`), у контракті теж відсутні — але ті, чия поява потім змінила б
 * уже написані запити чи сам контракт (`seq`, `clientMessageId`, `status`,
 * `visibility`), присутні з першого дня (design.md D7).
 */

/**
 * Стеля довжини репліки. КОНСТАНТА КОНТРАКТУ, а не env — та сама причина, що в
 * `AI_MAX_INPUT_CHARS`: значення запікається в Zod-схему, у `createZodDto` і в
 * опублікований OpenAPI-документ, і читання з оточення означало б, що ці троє
 * можуть розійтися.
 */
export const CHAT_MAX_MESSAGE_CHARS = 4000;

/** Стеля денормалізованого прев'ю останньої репліки в списку розмов */
export const CHAT_PREVIEW_CHARS = 160;

export const ConversationKindSchema = z.enum(['INTERNAL', 'CUSTOMER']);

/**
 * Доступ до самої розмови. ЗВЕТЬСЯ access, а не visibility: `visibility` уже
 * зайняте на репліці в зовсім іншому значенні (публічна vs внутрішня нотатка).
 *
 * `tenant` у переліку є, але сервер його НЕ створює і резолвер доступу його не
 * обробляє — доки не зʼявиться сценарій «оголошення для всіх» (docs/chat.md §6).
 */
export const ConversationAccessSchema = z.enum(['private', 'tenant']);

export const ConversationStatusSchema = z.enum(['OPEN', 'PENDING', 'SNOOZED', 'RESOLVED']);

export const ChatMessageKindSchema = z.enum(['TEXT', 'SYSTEM']);

export const ChatMessageVisibilitySchema = z.enum(['PUBLIC', 'INTERNAL']);

/**
 * Статус доставки. У цій фазі завжди `SENT`: канального адаптера ще немає, і
 * `QUEUED` нікому виставляти. Поле все одно в контракті — щоб футер бульбашки
 * не довелося писати вдруге в CHAT-2 (design.md D7).
 */
export const ChatMessageStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
]);

/**
 * Хто написав. Плоска трійка `senderType`/`senderId`/`senderLabel`, а не вкладена
 * сутність: `senderLabel` — СНАПШОТ підпису на момент написання, і саме він
 * тримає транскрипт читабельним після того, як людину деактивували або
 * перейменували. Плоска форма в проєкті зарезервована рівно за цим випадком
 * (CLAUDE.md, Backend module layering; так само в activities і notifications).
 *
 * Аватар за цим `senderId` клієнт бере зі списку учасників розмови — у стрічці
 * його не дублюємо.
 */
export const ChatSenderTypeSchema = z.enum(['user', 'system']);

/** Посилання на живого юзера — там, де він справді живий (список учасників) */
export const ChatUserRefSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  /** Presigned GET мініатюри (короткий TTL) — як у `UserResponse.avatarUrl` */
  avatarUrl: z.url().nullable(),
});

export const ConversationParticipantResponseSchema = ChatUserRefSchema.extend({
  role: z.string(),
  joinedAt: z.iso.datetime(),
});

/**
 * Системний запис у стрічці. Текст НЕ зберігається — тільки `type` і параметри,
 * рендер через i18next: та сама доктрина, що в activities і notifications
 * (бекенд віддає коди, мову вибирає читач).
 *
 * Дискримінований union, а не `Record<string, unknown>`: саме він не дає
 * розійтися тому, що пише сервер, і тому, що чекає рендерер.
 */
export const CHAT_SYSTEM_ENTRY_TYPES = ['conversation.created', 'member.added'] as const;

export const ChatSystemEntryTypeSchema = z.enum(CHAT_SYSTEM_ENTRY_TYPES);

/** Снапшот учасника в параметрах системного запису — як `EntityRef` в activities */
export const ChatMemberRefSchema = z.object({
  id: z.uuid(),
  label: z.string(),
});

export const ChatSystemPayloadSchema = z.discriminatedUnion('type', [
  /** Актор — відправник самого запису (`senderId`/`senderLabel`), тут не дублюється */
  z.object({ type: z.literal('conversation.created') }),
  z.object({ type: z.literal('member.added'), member: ChatMemberRefSchema }),
]);

export const ChatMessageResponseSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  /**
   * Серверний порядковий номер У МЕЖАХ РОЗМОВИ. Клієнт сортує і курсорить по
   * ньому, а не по `createdAt`: мітка часу не дає ні стабільного порядку, ні
   * курсора, ні детектора дірок (docs/chat.md §4.3).
   */
  seq: z.number().int().positive(),
  kind: ChatMessageKindSchema,
  visibility: ChatMessageVisibilitySchema,
  status: ChatMessageStatusSchema,
  senderType: ChatSenderTypeSchema,
  senderId: z.uuid().nullable(),
  senderLabel: z.string().nullable(),
  /** `null` для `kind = SYSTEM`: у системного запису тексту немає */
  body: z.string().nullable(),
  /** Для `SYSTEM` форму звужує `ChatSystemPayloadSchema`; для `TEXT` — порожній */
  payload: z.record(z.string(), z.unknown()),
  /** Повертається назад, щоб клієнт зшив оптимістичний рядок із серверним */
  clientMessageId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/**
 * Одна форма і для списку, і для картки розмови: детальний вигляд нічого не
 * додає, а спільна форма дає клієнтові засіяти кеш картки рядком зі списку.
 */
export const ConversationResponseSchema = z.object({
  id: z.uuid(),
  kind: ConversationKindSchema,
  access: ConversationAccessSchema,
  status: ConversationStatusSchema,
  /** Дефолтний канал тенанта — його не можна покинути й не можна створити другий */
  isDefault: z.boolean(),
  /** `null` — назви не задали; підпис збирається з учасників на клієнті */
  title: z.string().nullable(),
  participants: z.array(ConversationParticipantResponseSchema),
  lastMessageAt: z.iso.datetime().nullable(),
  /**
   * Прев'ю ОСТАННЬОЇ ТЕКСТОВОЇ репліки. `null` — реплік ще не було: системний
   * запис сюди не пише, бо тексту в нього немає за побудовою (design.md D5).
   */
  lastMessagePreview: z.string().nullable(),
  /** Непрочитані ТОГО, ХТО ПИТАЄ: у двох учасників вони різні */
  unreadCount: z.number().int().nonnegative(),
  /** Докуди дочитав той, хто питає — опора під роздільник «нові повідомлення» */
  lastReadSeq: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  /**
   * Інші учасники. Автор додається сервером завжди — питати про нього клієнта
   * означало б дозволити створити розмову, у яку сам не потрапив.
   */
  participantUserIds: z.array(z.uuid()).min(1).max(100),
});

export const PostChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_CHARS),
  /**
   * Ідемпотентність надсилання: подвійний тап і ретрай мережі не мають створити
   * дві репліки. Генерує клієнт; повтор повертає ТОЙ САМИЙ рядок, а не 409
   * (docs/chat.md §4.5).
   */
  clientMessageId: z.uuid(),
});

export const MarkConversationReadSchema = z.object({
  /** Рух тільки вперед: менше за поточне — легальний no-op, а не помилка */
  seq: z.number().int().nonnegative(),
});

/** Фільтрів у цій фазі немає: список — «мої розмови», завжди свіжі згори */
export const ConversationListQuerySchema = CursorQuerySchema;

export const ChatMessageListQuerySchema = CursorQuerySchema;

export const ConversationListResponseSchema = cursorResponseSchema(ConversationResponseSchema);

export const ChatMessageListResponseSchema = cursorResponseSchema(ChatMessageResponseSchema);
