import { z } from 'zod';
import { defineClientSocketEvent } from '../realtime/client-socket-event';
import { MarkConversationReadSchema } from './chat.schema';

/**
 * Події чату client → server (docs/chat.md §4.8.2). Реєструє їх `ChatSocketHandlers` у
 * `ClientEventRegistry`; realtime сам валідує payload за цими схемами і нормалізує відмову.
 *
 * `conversationId` — єдине, що клієнт називає. Tenant, юзер і роль беруться з перевіреного
 * токена сокета, а доступ до розмови перевіряє та сама функція, що й REST.
 */
const ConversationRefSchema = z.object({ conversationId: z.uuid() });

/** Ack підписки відлунює розмову — клієнтові простіше співставити відповідь із запитом */
const SubscribedSchema = z.object({ conversationId: z.uuid() });

const EmptySchema = z.object({});

export const CHAT_CLIENT_SOCKET_EVENTS = {
  /** «Ця розмова відкрита переді мною» — приєднує сокет до room-у після перевірки доступу */
  chatSubscribe: defineClientSocketEvent(
    'chat.subscribe.v1',
    ConversationRefSchema,
    SubscribedSchema,
  ),
  /** Зняти підписку; завжди `ok` — вийти з room-у ні прав, ні перевірки не потребує */
  chatUnsubscribe: defineClientSocketEvent(
    'chat.unsubscribe.v1',
    ConversationRefSchema,
    EmptySchema,
  ),
  /** «Я друкую» — імпульс; приймається лише від сокета, що вже в room-і розмови */
  chatTyping: defineClientSocketEvent('chat.typing.v1', ConversationRefSchema, EmptySchema),
  /** Рух курсора прочитаного; ефект і обмеження ті самі, що в `POST /conversations/:id/read` */
  chatRead: defineClientSocketEvent(
    'chat.read.v1',
    MarkConversationReadSchema.extend(ConversationRefSchema.shape),
    EmptySchema,
  ),
};
