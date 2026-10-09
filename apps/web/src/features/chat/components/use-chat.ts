import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  chatFindAll,
  chatMarkRead,
  chatPost,
  chatTranscript,
  getChatFindAllQueryKey,
  getChatTranscriptQueryKey,
} from '../../../api/generated/api';
import type { ChatMessageListResponseDtoOutputItemsItem } from '../../../api/generated/model/chatMessageListResponseDtoOutputItemsItem';
import type { ConversationListResponseDtoOutputItemsItem } from '../../../api/generated/model/conversationListResponseDtoOutputItemsItem';
import { CONVERSATIONS_PAGE, TRANSCRIPT_PAGE, conversationListKey } from '../chat-keys';
import { mergeIncomingMessage } from '../realtime/chat-cache';
import { useChatOutboxStore } from '../stores/chat-outbox.store';

export type Conversation = ConversationListResponseDtoOutputItemsItem;
export type ChatMessage = ChatMessageListResponseDtoOutputItemsItem;

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
 * (design.md D8 фази 0.1), тому тут лишається рівно дві дії: покласти його туди і, коли
 * сервер відповів, злити збережене повідомлення в кеш стрічки тим самим правилом `seq`,
 * що й відлуння сокета (`mergeIncomingMessage`, design.md D4 фази 0.2a). Відповідь і подія
 * можуть прийти в будь-якому порядку — рядок у стрічці при цьому один, а сам `send`
 * підтверджується і коли сокет лежить.
 */
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const { enqueue, markFailed, markSending } = useChatOutboxStore.getState();

  const mutation = useMutation({
    mutationFn: ({ body, clientMessageId }: { body: string; clientMessageId: string }) =>
      chatPost(conversationId, { body, clientMessageId }),
    onSuccess: async (message) => {
      mergeIncomingMessage(queryClient, conversationId, message);
      // Прев'ю й порядок у списку змінились; лічильники в ньому персональні — перечитуємо
      await queryClient.invalidateQueries({ queryKey: conversationListKey() });
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

/** Рух курсора прочитаного. Відмова тут нічого не ламає — бейдж просто лишиться */
export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (seq: number) => chatMarkRead(conversationId, { seq }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conversationListKey() });
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
