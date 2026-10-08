import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import {
  aiListConversations,
  getAiConversationQueryKey,
  getAiListConversationsQueryKey,
} from '../../api/generated/api';
import type { AiConversationListResponseDtoOutputItemsItem } from '../../api/generated/model/aiConversationListResponseDtoOutputItemsItem';

export type AiConversationSummary = AiConversationListResponseDtoOutputItemsItem;

const HISTORY_PAGE = 30;

/**
 * Префікс ключів історії: і список (`/api/ai/conversations`), і розмова за id
 * (`/api/ai/conversations/<id>`). Поточна розмова (`/api/ai/conversation`, однина) сюди
 * НЕ потрапляє — її кеш живе окремо, бо в нього пише стрім (`ai-sync.ts`).
 */
const HISTORY_KEY_PREFIX = '/api/ai/conversations';

/** Історія розмов для колонки area «Assistant»: курсорний фід, свіжі згори */
export function useAiHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: getAiListConversationsQueryKey({ limit: HISTORY_PAGE }),
    queryFn: ({ pageParam, signal }) =>
      aiListConversations(
        { limit: HISTORY_PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/** Перечитати історію (список і відкриті минулі розмови), не чіпаючи поточну */
export function invalidateAiHistory(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [head] = query.queryKey;
      return typeof head === 'string' && head.startsWith(HISTORY_KEY_PREFIX);
    },
  });
}

/**
 * Після власної дії (питання, нова розмова, активація, видалення): поточна розмова
 * плюс історія. Socket-сигнал `ai.conversation-changed.v1` зробить те саме в інших
 * вкладках, а тут — без очікування на нього.
 */
export async function invalidateAiConversations(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getAiConversationQueryKey() }),
    invalidateAiHistory(queryClient),
  ]);
}
