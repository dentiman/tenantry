import {
  getChatFindAllQueryKey,
  getChatTranscriptQueryKey,
  getChannelInboxListQueryKey,
} from '../../api/generated/api';
import type { ChannelInboxListFilter } from '../../api/generated/model/channelInboxListFilter';

/**
 * Розміри сторінок і ключі кеша чату в одному місці: їх потрібні і хукам (`use-chat.ts`),
 * і мосту сокета (`realtime/chat-cache.ts`, `chat-sync.ts`), і ключі мають збігатися
 * до символу, інакше подія патчить не той запит, який читає екран.
 */
export const CONVERSATIONS_PAGE = 30;
export const TRANSCRIPT_PAGE = 30;
export const INBOX_PAGE = 30;

export function conversationListKey() {
  return getChatFindAllQueryKey({ limit: CONVERSATIONS_PAGE });
}

export function transcriptKey(conversationId: string) {
  return getChatTranscriptQueryKey(conversationId, { limit: TRANSCRIPT_PAGE });
}

export function inboxKey(filter: ChannelInboxListFilter) {
  return getChannelInboxListQueryKey({ limit: INBOX_PAGE, filter });
}

/** Префікс скриньки клієнтських розмов: інвалідація по ньому зачіпає всі фільтри */
export const INBOX_KEY_PREFIX = '/api/chat/inbox';

/** Префікс усіх запитів чату в кеші: список, картка і стрічка — за першим елементом ключа */
const CHAT_KEY_PREFIX = '/api/conversations';

export function isChatQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  return (
    typeof head === 'string' &&
    (head.startsWith(CHAT_KEY_PREFIX) || head.startsWith(INBOX_KEY_PREFIX))
  );
}
