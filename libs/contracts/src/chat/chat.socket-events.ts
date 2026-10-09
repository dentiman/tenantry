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

/** Події сокета чату (docs/chat.md §4.8); збирає root `socket-events.ts` */
export const CHAT_SOCKET_EVENTS = {
  chatMessageCreated: defineSocketEvent('chat.message-created.v1', ChatMessageCreatedSchema),
  chatConversationChanged: defineSocketEvent(
    'chat.conversation-changed.v1',
    ChatConversationChangedSchema,
  ),
};
