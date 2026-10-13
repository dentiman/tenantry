import { z } from 'zod';
import { defineSocketEvent } from '../realtime/socket-event';
import { ChatMessageResponseSchema } from './chat.schema';

/**
 * Нова запис у стрічці розмови (docs/chat.md §4.8). Летить в особисті room-и ВСІХ
 * активних учасників на момент коміту, включно з автором: у нього можуть бути інші
 * вкладки, і оптимістичний рядок цієї вкладки зшивається з відлунням по `clientMessageId`.
 *
 * Везе ПОВНИЙ рядок, а не сигнал «перечитай» — за прикладом `notification.created.v1`:
 * сервер уже тримає рядок, а `seq` дає клієнтові повне правило «застосувати / проігнорувати /
 * дочитати з REST» (наступний → застосувати, не новіший → ігнор, дірка → перечитати стрічку).
 * Це саме та страховка, без якої payload у сокеті не допускається (AGENTS.md, правило 15):
 * монотонний лічильник + resync через REST. Джерелом правди лишається Postgres.
 *
 * `message` — той самий вихід мапера, що й у REST (`toChatMessageResponse`), тому дві
 * форми не можуть розійтися.
 */
export const ChatMessageCreatedSchema = z.object({
  conversationId: z.uuid(),
  message: ChatMessageResponseSchema,
  occurredAt: z.iso.datetime(),
});

export type ChatMessageCreated = z.infer<typeof ChatMessageCreatedSchema>;

/**
 * Зміна на рівні розмови для одного юзера: що саме і де перечитати.
 *
 * НЕ несе ні лічильників непрочитаних, ні прев'ю: вони персональні і впорядковані на
 * сервері, тому клієнт список перечитує. Не несе і чужих позицій прочитаного — `read`
 * летить лише власнику курсора, в усі його вкладки.
 */
export const ChatConversationChangeSchema = z.enum(['created', 'membership', 'read']);

export const ChatConversationChangedSchema = z.object({
  conversationId: z.uuid(),
  change: ChatConversationChangeSchema,
  occurredAt: z.iso.datetime(),
});

export type ChatConversationChange = z.infer<typeof ChatConversationChangeSchema>;
export type ChatConversationChanged = z.infer<typeof ChatConversationChangedSchema>;

/**
 * «Хтось друкує» (docs/chat.md §4.8.2). Ефемерне: ніде не зберігається і гасне само.
 *
 * Термін — ВІДНОСНИЙ (`expiresInMs`), а не абсолютний `until`: клієнт перетворює його на
 * локальний дедлайн у момент отримання, тож годинник, що поспішає чи відстає на хвилини, не
 * змусить індикатор зникнути одразу чи висіти вічно.
 *
 * Летить усім сокетам room-у розмови, КРІМ відправника, — отже, інші вкладки самого
 * друкуючого його теж отримують; клієнт відкидає події зі своїм `userId`.
 */
export const ChatTypingChangedSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  expiresInMs: z.number().int().positive(),
});

export type ChatTypingChanged = z.infer<typeof ChatTypingChangedSchema>;

/**
 * Сигнал скриньці клієнтських розмов: «в цій розмові щось змінилося, перечитай»
 * (CHAT-2a, design.md D8). Летить у room тенанта. Не несе ні повідомлення, ні
 * лічильників — тому правило AGENTS.md №15 (payload лише з монотонним лічильником
 * і REST-resync) його не стосується: втрата сигналу нічого не губить, стан у Postgres.
 */
export const ChatInboxChangedSchema = z.object({
  conversationId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

export type ChatInboxChanged = z.infer<typeof ChatInboxChangedSchema>;

/**
 * Стан доставки вихідного змінився (CHAT-2b, design.md D10): «перечитай повідомлення». Летить у
 * room тенанта (клієнтську розмову бачать усі) і не несе ні статусу, ні лічильників — правило
 * AGENTS.md №15 його не стосується: втрата сигналу нічого не губить, стан у Postgres.
 */
export const ChatMessageUpdatedSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

export type ChatMessageUpdated = z.infer<typeof ChatMessageUpdatedSchema>;

/** Події сокета чату (docs/chat.md §4.8); збирає root `socket-events.ts` */
export const CHAT_SOCKET_EVENTS = {
  chatMessageCreated: defineSocketEvent('chat.message-created.v1', ChatMessageCreatedSchema),
  chatConversationChanged: defineSocketEvent(
    'chat.conversation-changed.v1',
    ChatConversationChangedSchema,
  ),
  chatTypingChanged: defineSocketEvent('chat.typing-changed.v1', ChatTypingChangedSchema),
  chatInboxChanged: defineSocketEvent('chat.inbox-changed.v1', ChatInboxChangedSchema),
  chatMessageUpdated: defineSocketEvent('chat.message-updated.v1', ChatMessageUpdatedSchema),
};
