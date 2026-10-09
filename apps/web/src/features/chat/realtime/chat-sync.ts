import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type ChatConversationChanged,
  type ChatMessageCreated,
} from '@saas-skeleton/contracts';
import { getChatFindOneQueryKey } from '../../../api/generated/api';
import { getSocket, type AppSocket } from '../../realtime/socket';
import { conversationListKey, isChatQueryKey } from '../chat-keys';
import { mergeIncomingMessage } from './chat-cache';

/**
 * Міст socket → TanStack Query для чату (docs/chat.md §4.8, CHAT-0.2a). Той самий принцип,
 * що в `notification-sync.ts` і `calendar-sync.ts`: server state живе в кеші запитів, сокет
 * його патчить або інвалідує, а не стає другим джерелом правди.
 *
 * Дві різні поведінки, бо дві різні події:
 *
 * - `chat.message-created.v1` везе повний рядок і `seq`, тому стрічку ПАТЧИМО за правилом
 *   «наступний → застосувати, не новіший → ігнор, дірка → перечитати» (`mergeIncomingMessage`).
 *   Список розмов перечитуємо: непрочитані в ньому персональні, а порядок серверний, і
 *   вставляти рядок у пагіновані сторінки означало б вгадувати.
 * - `chat.conversation-changed.v1` — сигнал «перечитай» без даних. Список перечитується
 *   завжди; картка (склад учасників) — коли склад міг змінитись.
 *
 * Сокет — лише прискорення: втрачена подія нічого не втрачає, а на розрив, який Socket.IO не
 * відновив, перечитується весь чат. `refetchOnWindowFocus` лишається страховкою.
 */
export function initChatSync(queryClient: QueryClient, socket: AppSocket = getSocket()): void {
  const invalidateList = (): void => {
    void queryClient.invalidateQueries({ queryKey: conversationListKey() });
  };

  socket.on(REALTIME_EVENTS.chatMessageCreated, (payload: ChatMessageCreated) => {
    mergeIncomingMessage(queryClient, payload.conversationId, payload.message);
    invalidateList();
  });

  socket.on(REALTIME_EVENTS.chatConversationChanged, (payload: ChatConversationChanged) => {
    invalidateList();
    if (payload.change === 'created' || payload.change === 'membership') {
      // Склад учасників живе в картці. Стрічку тут не чіпаємо: запис `member.added`
      // долітає окремою `chat.message-created.v1`, і її правило `seq` уже відпрацювало
      void queryClient.invalidateQueries({
        queryKey: getChatFindOneQueryKey(payload.conversationId),
      });
    }
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети сесії. Якщо ні — невідомо, що
    // сталося за час розриву, і подіям довіряти не можна
    if (!socket.recovered) {
      void queryClient.invalidateQueries({ predicate: (query) => isChatQueryKey(query.queryKey) });
    }
  });
}
