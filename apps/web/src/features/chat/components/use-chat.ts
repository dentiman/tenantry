import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  chatFindAll,
  chatMarkRead,
  chatPost,
  chatResend,
  chatTranscript,
  getChatFindAllQueryKey,
  getChatFindOneQueryKey,
  getChatTranscriptQueryKey,
} from '../../../api/generated/api';
import type { ChatMessageListResponseDtoOutputItemsItem } from '../../../api/generated/model/chatMessageListResponseDtoOutputItemsItem';
import type { ConversationListResponseDtoOutputItemsItem } from '../../../api/generated/model/conversationListResponseDtoOutputItemsItem';
import { CONVERSATIONS_PAGE, TRANSCRIPT_PAGE, conversationListKey } from '../chat-keys';
import { mergeIncomingMessage } from '../realtime/chat-cache';
import { reportRead } from '../realtime/chat-socket';
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
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const { enqueue, markFailed, markSending, discard } = useChatOutboxStore.getState();

  const mutation = useMutation({
    mutationFn: ({
      body,
      clientMessageId,
      visibility,
    }: {
      body: string;
      clientMessageId: string;
      visibility: 'PUBLIC' | 'INTERNAL';
    }) => chatPost(conversationId, { body, clientMessageId, visibility }),
    onSuccess: async (message) => {
      mergeIncomingMessage(queryClient, conversationId, message);
      // Прев'ю й порядок у списку змінились; лічильники в ньому персональні — перечитуємо. Картка
      // теж: відповідь могла призначити розмову автору чи відкрити розв'язану
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationListKey() }),
        queryClient.invalidateQueries({ queryKey: getChatFindOneQueryKey(conversationId) }),
      ]);
    },
    onError: (error, variables) => {
      // Вікно закрилось, поки екран був відкритий: повтор безглуздий, тож рядок не лишається
      // «ненадісланим» — знімається, картка перечитується (покаже пояснення замість поля відповіді)
      if (isWindowClosed(error)) {
        discard(conversationId, variables.clientMessageId);
        void queryClient.invalidateQueries({ queryKey: getChatFindOneQueryKey(conversationId) });
        toast.add({ type: 'error', title: t('composer.windowClosedToast') });
        return;
      }
      markFailed(conversationId, variables.clientMessageId);
    },
    // Відмова показується в самому рядку (стан «не надіслано» з повтором),
    // тому глобальний тост тут був би другим повідомленням про те саме
    meta: { silentError: true },
  });

  const send = useCallback(
    (body: string, clientMessageId: string, visibility: 'PUBLIC' | 'INTERNAL' = 'PUBLIC') => {
      enqueue(conversationId, body, clientMessageId, visibility);
      mutation.mutate({ body, clientMessageId, visibility });
    },
    [conversationId, enqueue, mutation],
  );

  /** Повтор іде з ТИМ САМИМ id — сервер поверне той самий рядок, а не другий */
  const retry = useCallback(
    (body: string, clientMessageId: string) => {
      const entry = useChatOutboxStore
        .getState()
        .pending[conversationId]?.find((item) => item.clientMessageId === clientMessageId);
      markSending(conversationId, clientMessageId);
      mutation.mutate({ body, clientMessageId, visibility: entry?.visibility ?? 'PUBLIC' });
    },
    [conversationId, markSending, mutation],
  );

  return { send, retry };
}

/** Серверний код «вікно вільного тексту закрите» (`ApiError.code`, CHAT-2b) */
function isWindowClosed(error: unknown): boolean {
  return (
    isAxiosError(error) &&
    (error.response?.data as { code?: string } | undefined)?.code === 'CHANNEL_WINDOW_CLOSED'
  );
}

/**
 * Повторити відправку невдалого вихідного (CHAT-2b): те саме повідомлення знову в чергу. Результат
 * приходить сигналом `chat.message-updated.v1`, але відповідь теж перечитує стрічку — сокет може лежати.
 */
export function useResendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => chatResend(conversationId, messageId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getChatTranscriptQueryKey(conversationId, { limit: TRANSCRIPT_PAGE }),
      });
    },
  });
}

/**
 * Рух курсора прочитаного: через сокет (`chat.read.v1`), а коли він не підключений чи сервер
 * не підтвердив — запасним REST. Відмова тут нічого не ламає: бейдж просто лишиться, а наступне
 * підтвердження зрушить курсор далі. Список перечитує лише REST-шлях; для сокетного відлуння
 * `chat.conversation-changed.v1` приходить саме (design.md D5 фази 0.2b).
 */
export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient();

  const rest = useMutation({
    mutationFn: (seq: number) => chatMarkRead(conversationId, { seq }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conversationListKey() });
    },
    meta: { silentError: true },
  });
  const { mutate } = rest;

  return useCallback(
    (seq: number) => {
      void reportRead(conversationId, seq, (fallbackSeq) => {
        mutate(fallbackSeq);
      });
    },
    [conversationId, mutate],
  );
}
