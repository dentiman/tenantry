import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  chatFindAll,
  chatMarkRead,
  chatPost,
  chatTranscript,
  getChatFindAllQueryKey,
  getChatFindOneQueryKey,
  getChatTranscriptQueryKey,
} from '../../api/generated/api';
import type { ChatMessageListResponseDtoOutputItemsItem } from '../../api/generated/model/chatMessageListResponseDtoOutputItemsItem';
import type { ConversationListResponseDtoOutputItemsItem } from '../../api/generated/model/conversationListResponseDtoOutputItemsItem';
import { useChatOutboxStore } from '../../stores/chat-outbox.store';

export type Conversation = ConversationListResponseDtoOutputItemsItem;
export type ChatMessage = ChatMessageListResponseDtoOutputItemsItem;

const CONVERSATIONS_PAGE = 30;
const TRANSCRIPT_PAGE = 30;

/**
 * Чат живе без realtime (фаза CHAT-0.1), тому свіжість тримається на перечитуванні:
 * коротший `staleTime` за глобальні 30 с (`main.tsx`) — інакше повернення у вікно
 * нічого б не перезапитало і екран мовчки показував би вчорашній стан.
 *
 * `refetchInterval` тут НЕМАЄ свідомо: у `0.2` його довелося б знімати, а до того
 * він маскував би помилки курсора, перечитуючи все кожні N секунд (design.md D8).
 */
const CHAT_STALE_TIME = 5_000;

/** Список розмов: курсорний фід, свіжі згори */
export function useConversationList() {
  return useInfiniteQuery({
    queryKey: getChatFindAllQueryKey({ limit: CONVERSATIONS_PAGE }),
    queryFn: ({ pageParam, signal }) =>
      chatFindAll(
        { limit: CONVERSATIONS_PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: CHAT_STALE_TIME,
  });
}

/**
 * Стрічка розмови. Сервер віддає сторінки від найсвіжішої ВНИЗ (keyset по `seq`),
 * тому «наступна сторінка» тут — це СТАРІША історія, а для рендера порядок
 * розвертається.
 */
export function useTranscript(conversationId: string) {
  return useInfiniteQuery({
    queryKey: getChatTranscriptQueryKey(conversationId, { limit: TRANSCRIPT_PAGE }),
    queryFn: ({ pageParam, signal }) =>
      chatTranscript(
        conversationId,
        { limit: TRANSCRIPT_PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: CHAT_STALE_TIME,
    enabled: conversationId !== '',
  });
}

/** Плоский список від найстарішого до найсвіжішого — готовий до рендера */
export function flattenTranscript(pages: { items: ChatMessage[] }[] | undefined): ChatMessage[] {
  if (!pages) {
    return [];
  }
  // Сторінки приходять від найсвіжішої; всередині сторінки — теж спадання
  return pages.flatMap((page) => page.items).reverse();
}

export function flattenConversations(
  pages: { items: Conversation[] }[] | undefined,
): Conversation[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/**
 * Надсилання. Оптимістичний рядок живе в окремому сторі, а не в кеші запиту
 * (design.md D8), тому тут лишається рівно дві дії: покласти його туди і, коли
 * сервер відповів, прибрати — стрічку до того моменту вже перечитали.
 */
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const { enqueue, markFailed, markSending, resolve } = useChatOutboxStore.getState();

  const mutation = useMutation({
    mutationFn: ({ body, clientMessageId }: { body: string; clientMessageId: string }) =>
      chatPost(conversationId, { body, clientMessageId }),
    onSuccess: async (_message, variables) => {
      resolve(conversationId, variables.clientMessageId);
      // Стрічка і список — одним рухом: прев'ю та порядок у списку теж змінились
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getChatTranscriptQueryKey(conversationId, { limit: TRANSCRIPT_PAGE }),
        }),
        queryClient.invalidateQueries({
          queryKey: getChatFindAllQueryKey({ limit: CONVERSATIONS_PAGE }),
        }),
      ]);
    },
    onError: (_error, variables) => {
      markFailed(conversationId, variables.clientMessageId);
    },
    // Відмова показується в самому рядку (стан «не надіслано» з повтором),
    // тому глобальний тост тут був би другим повідомленням про те саме
    meta: { silentError: true },
  });

  const send = useCallback(
    (body: string, clientMessageId: string) => {
      enqueue(conversationId, body, clientMessageId);
      mutation.mutate({ body, clientMessageId });
    },
    [conversationId, enqueue, mutation],
  );

  /** Повтор іде з ТИМ САМИМ id — сервер поверне той самий рядок, а не другий */
  const retry = useCallback(
    (body: string, clientMessageId: string) => {
      markSending(conversationId, clientMessageId);
      mutation.mutate({ body, clientMessageId });
    },
    [conversationId, markSending, mutation],
  );

  return { send, retry };
}

/**
 * Явне оновлення всієї area: картка, стрічка і список розмов разом.
 *
 * Саме разом, а не `refetch()` однієї картки: без realtime кнопка «Оновити» —
 * єдиний спосіб дізнатись про чужу репліку, і оновити при цьому лише заголовок
 * означало б збрехати кнопкою. Список теж перечитується — інакше прев'ю і
 * бейдж непрочитаних лишились би вчорашніми.
 */
export function useRefreshChat(conversationId: string) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatFindOneQueryKey(conversationId) }),
      queryClient.invalidateQueries({
        queryKey: getChatTranscriptQueryKey(conversationId, { limit: TRANSCRIPT_PAGE }),
      }),
      queryClient.invalidateQueries({
        queryKey: getChatFindAllQueryKey({ limit: CONVERSATIONS_PAGE }),
      }),
    ]);
  }, [conversationId, queryClient]);
}

/** Рух курсора прочитаного. Відмова тут нічого не ламає — бейдж просто лишиться */
export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (seq: number) => chatMarkRead(conversationId, { seq }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getChatFindAllQueryKey({ limit: CONVERSATIONS_PAGE }),
      });
    },
    meta: { silentError: true },
  });

  return useCallback(
    (seq: number) => {
      mutation.mutate(seq);
    },
    [mutation],
  );
}
