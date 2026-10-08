import { z } from 'zod';
import { defineSocketEvent } from '../realtime/socket-event';

/**
 * ПЕРШИЙ У ЦЬОМУ РЕПОЗИТОРІЇ випадок, коли socket-подія несе САМ ВМІСТ, а не сигнал
 * «перечитай» (docs/realtime.md § «Межа з event-driven шаром», правило 2). Це
 * свідомий виняток, і він тримається на двох страховках — копіювати патерн без них
 * не можна:
 *
 * 1. `chunkSeq` монотонний у межах ОДНІЄЇ відповіді. Дірка в нумерації означає, що
 *    дельту загублено, і клієнт іде за `GET /ai/conversation` — там лежить той самий
 *    текст із Postgres. Тобто втрата дельти сповільнює рендер, але нічого не втрачає.
 * 2. `chunkSeq === 0` для відповіді, у якій уже є текст, означає ПЕРЕЗАПУСК генерації
 *    (автоматичний ретрай після тимчасової відмови провайдера): клієнт викидає
 *    накопичене і починає спочатку, інакше дві спроби склеїлись би в одну відповідь.
 *
 * Джерелом правди лишається БД; сокет — лише прискорення.
 */
export const AiMessageDeltaSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /**
   * Номер спроби генерації, якій належить ця дельта (AI-0.1, design.md D1/D6).
   * Фенсинг-токен: дельта нижчої спроби за ту, що клієнт уже показує, — застаріла
   * і відкидається; вища спроба означає перезапуск. Це замінює стару ознаку
   * перезапуску `chunkSeq === 0` — вона сама по собі не відрізняла б перезапуск
   * від дельти застарілої спроби з тим самим номером кадру.
   */
  attempt: z.number().int().nonnegative(),
  chunkSeq: z.number().int().nonnegative(),
  /** Приріст тексту, а не весь текст: чанки конкатенуються в порядку `chunkSeq` */
  text: z.string(),
});

/**
 * Термінальний стан відповіді. `status` тут ніколи не `PENDING`/`STREAMING`.
 * Подія надходить ПІСЛЯ комміту рядка (after-commit хук), тому клієнт, який у
 * відповідь на неї перечитає стрічку, гарантовано побачить фінальний текст.
 */
export const AiMessageCompletedSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  status: z.enum(['COMPLETE', 'FAILED', 'CANCELLED']),
  errorCode: z.enum(['PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INTERNAL']).nullable(),
  occurredAt: z.iso.datetime(),
});

/**
 * Сигнал «розмова змінилась», без даних (AI-0.1, design.md D7). Єдина причина
 * її існування — інші вкладки того самого юзера: `ai.message-delta.v1` доходить
 * лише туди, де повідомлення вже в кеші, а перше питання ходу та `reset()`
 * жодної дельти не мають. Реакція клієнта — одне дедупліковане перечитування
 * стрічки; сам факт лишається джерелом правди, як і решта realtime (docs/realtime.md).
 */
export const AiConversationChangedSchema = z.object({
  // ai-1e: null для 'deleted' — «видалити мої розмови» прибирає ВСІ розмови юзера
  // одразу, тож жодна конкретна не є «тією, що змінилась»
  conversationId: z.uuid().nullable(),
  reason: z.enum(['turn-created', 'reply-closed', 'reset', 'deleted', 'activated']),
  occurredAt: z.iso.datetime(),
});

export type AiMessageDelta = z.infer<typeof AiMessageDeltaSchema>;
export type AiMessageCompleted = z.infer<typeof AiMessageCompletedSchema>;
export type AiConversationChanged = z.infer<typeof AiConversationChangedSchema>;

/**
 * Події сокета асистента; збирає root `socket-events.ts`. `ai.message-delta.v1` — ЄДИНИЙ
 * виняток із правила «сокет каже перечитати, а не несе дані» (AGENTS.md п.15): він безпечний
 * лише разом із гардами `attempt` / `chunkSeq` / `chunkCount`, тож переноситься тільки з ними.
 */
export const AI_SOCKET_EVENTS = {
  aiMessageDelta: defineSocketEvent('ai.message-delta.v1', AiMessageDeltaSchema),
  aiMessageCompleted: defineSocketEvent('ai.message-completed.v1', AiMessageCompletedSchema),
  aiConversationChanged: defineSocketEvent(
    'ai.conversation-changed.v1',
    AiConversationChangedSchema,
  ),
};
