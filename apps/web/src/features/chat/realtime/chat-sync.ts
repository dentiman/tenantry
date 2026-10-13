import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type ChatConversationChanged,
  type ChatInboxChanged,
  type ChatMessageCreated,
  type ChatTypingChanged,
} from '@saas-skeleton/contracts';
import { getChatFindOneQueryKey } from '../../../api/generated/api';
import { useAuthStore } from '../../auth/stores/auth.store';
import { getSocket, type AppSocket } from '../../realtime/socket';
import { INBOX_KEY_PREFIX, conversationListKey, isChatQueryKey, transcriptKey } from '../chat-keys';
import { useChatTypingStore } from '../stores/chat-typing.store';
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
    // Людина надіслала репліку — «друкує…» гасне одразу, не чекаючи терміну
    if (payload.message.senderId) {
      useChatTypingStore.getState().clear(payload.conversationId, payload.message.senderId);
    }
  });

  // Ефемерне, тільки у стор: ні кеша запитів, ні перечитувань. Власні події (інша вкладка
  // того самого юзера теж у room-і) відкидаємо тут — сервер їх не відсікає свідомо
  socket.on(REALTIME_EVENTS.chatTypingChanged, (payload: ChatTypingChanged) => {
    if (payload.userId === useAuthStore.getState().user?.id) {
      return;
    }
    useChatTypingStore
      .getState()
      .pulse(payload.conversationId, payload.userId, payload.expiresInMs);
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

  // CHAT-2a: «у клієнтській розмові щось змінилось» — сигнал без даних. Скринька перечитується
  // для всіх фільтрів; відкриту розмову (стрічка й картка) — теж: payload не несе повідомлення,
  // тож застосовувати нічого, а Postgres лишається джерелом правди
  socket.on(REALTIME_EVENTS.chatInboxChanged, (payload: ChatInboxChanged) => {
    void queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith(INBOX_KEY_PREFIX),
    });
    void queryClient.invalidateQueries({ queryKey: transcriptKey(payload.conversationId) });
    void queryClient.invalidateQueries({
      queryKey: getChatFindOneQueryKey(payload.conversationId),
    });
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети сесії. Якщо ні — невідомо, що
    // сталося за час розриву, і подіям довіряти не можна
    if (!socket.recovered) {
      void queryClient.invalidateQueries({ predicate: (query) => isChatQueryKey(query.queryKey) });
    }
  });
}
