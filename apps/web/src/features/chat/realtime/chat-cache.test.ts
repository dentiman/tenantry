import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ChatMessageListResponseDtoOutput } from '../../../api/generated/model/chatMessageListResponseDtoOutput';
import type { ChatMessageListResponseDtoOutputItemsItem as ChatMessage } from '../../../api/generated/model/chatMessageListResponseDtoOutputItemsItem';
import { transcriptKey } from '../chat-keys';
import { useChatOutboxStore } from '../stores/chat-outbox.store';
import { mergeIncomingMessage } from './chat-cache';

/**
 * Правило злиття збереженого повідомлення в кеш стрічки (design.md D4, фаза 0.2a):
 * кожен рядок таблиці — окремий тест. Сокет і `onSuccess` надсилання користуються
 * однією функцією, тож перевіряємо саме її, а не міст.
 */

const CONVERSATION = '11111111-1111-4111-8111-111111111111';

function message(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    conversationId: CONVERSATION,
    seq,
    kind: 'TEXT',
    visibility: 'PUBLIC',
    status: 'SENT',
    senderType: 'user',
    senderId: null,
    senderLabel: 'Alice',
    body: `message ${String(seq)}`,
    payload: {},
    clientMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

/** Серверні сторінки — від найсвіжішої; всередині сторінки теж спадання */
function seed(queryClient: QueryClient, pages: ChatMessage[][]): void {
  const data: InfiniteData<ChatMessageListResponseDtoOutput, string | undefined> = {
    pages: pages.map((items, index) => ({
      items,
      nextCursor: index < pages.length - 1 ? `cursor-${String(index)}` : null,
    })),
    pageParams: pages.map((_, index) => (index === 0 ? undefined : `cursor-${String(index - 1)}`)),
  };
  queryClient.setQueryData(transcriptKey(CONVERSATION), data);
}

function cachedSeqs(queryClient: QueryClient): number[][] {
  const data = queryClient.getQueryData<InfiniteData<ChatMessageListResponseDtoOutput>>(
    transcriptKey(CONVERSATION),
  );
  return data?.pages.map((page) => page.items.map((item) => item.seq)) ?? [];
}

function outboxCount(): number {
  return useChatOutboxStore.getState().pending[CONVERSATION]?.length ?? 0;
}

describe('mergeIncomingMessage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useChatOutboxStore.setState({ pending: {} });
  });

  it('prepends the message that directly follows the newest cached one', () => {
    seed(queryClient, [[message(5), message(4)], [message(3)]]);

    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(6))).toBe('applied');

    // У сторінку 0, не в кінець: курсори решти сторінок лишаються чинними
    expect(cachedSeqs(queryClient)).toEqual([[6, 5, 4], [3]]);
    const data = queryClient.getQueryData<InfiniteData<ChatMessageListResponseDtoOutput>>(
      transcriptKey(CONVERSATION),
    );
    expect(data?.pages.map((page) => page.nextCursor)).toEqual(['cursor-0', null]);
  });

  it('ignores a duplicate or older message and leaves the cache untouched', () => {
    seed(queryClient, [[message(5), message(4)]]);

    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(5))).toBe('ignored');
    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(3))).toBe('ignored');

    expect(cachedSeqs(queryClient)).toEqual([[5, 4]]);
  });

  it('applies the same message once when the response and the socket echo both arrive', () => {
    seed(queryClient, [[message(5)]]);

    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(6))).toBe('applied');
    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(6))).toBe('ignored');

    expect(cachedSeqs(queryClient)).toEqual([[6, 5]]);
  });

  it('re-reads the transcript instead of applying when a gap is revealed', () => {
    seed(queryClient, [[message(5)]]);

    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(7))).toBe('resync');

    // Дірку не латаємо вгадуванням: кеш лишається як був, а запит позначений на перечитування
    expect(cachedSeqs(queryClient)).toEqual([[5]]);
    expect(queryClient.getQueryState(transcriptKey(CONVERSATION))?.isInvalidated).toBe(true);
  });

  it('does nothing to a transcript nobody has opened', () => {
    expect(mergeIncomingMessage(queryClient, CONVERSATION, message(6))).toBe('no-cache');

    expect(queryClient.getQueryData(transcriptKey(CONVERSATION))).toBeUndefined();
  });

  it('settles the optimistic entry in the same call that applies the confirmed message', () => {
    seed(queryClient, [[message(5)]]);
    const { enqueue } = useChatOutboxStore.getState();
    enqueue(CONVERSATION, 'hello', 'cid-1');
    enqueue(CONVERSATION, 'still sending', 'cid-2');

    mergeIncomingMessage(queryClient, CONVERSATION, message(6, { clientMessageId: 'cid-1' }));

    // Знімається рівно свій рядок; чужий ненадісланий лишається
    expect(outboxCount()).toBe(1);
    expect(useChatOutboxStore.getState().pending[CONVERSATION]?.[0]?.clientMessageId).toBe('cid-2');
  });

  it('settles the optimistic entry for a duplicate too', () => {
    seed(queryClient, [[message(6, { clientMessageId: 'cid-1' }), message(5)]]);
    useChatOutboxStore.getState().enqueue(CONVERSATION, 'hello', 'cid-1');

    expect(
      mergeIncomingMessage(queryClient, CONVERSATION, message(6, { clientMessageId: 'cid-1' })),
    ).toBe('ignored');

    expect(outboxCount()).toBe(0);
  });

  it('keeps the optimistic entry until the re-read settles when a gap is revealed', async () => {
    seed(queryClient, [[message(5)]]);
    useChatOutboxStore.getState().enqueue(CONVERSATION, 'hello', 'cid-1');

    mergeIncomingMessage(queryClient, CONVERSATION, message(8, { clientMessageId: 'cid-1' }));

    // Повідомлення в кеші ще немає — сховати рядок зараз означало б зникнення репліки
    expect(outboxCount()).toBe(1);
    await vi.waitFor(() => {
      expect(outboxCount()).toBe(0);
    });
  });
});
