import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type ChatConversationChanged,
  type ChatInboxChanged,
  type ChatMessageCreated,
  type ChatTypingChanged,
} from '@saas-skeleton/contracts';
import { getChatFindOneQueryKey } from '../../../api/generated/api';
import type { ChatMessageListResponseDtoOutput } from '../../../api/generated/model/chatMessageListResponseDtoOutput';
import type { AppSocket } from '../../realtime/socket';
import { conversationListKey, inboxKey, transcriptKey } from '../chat-keys';
import { useAuthStore } from '../../auth/stores/auth.store';
import { useChatOutboxStore } from '../stores/chat-outbox.store';
import { useChatTypingStore } from '../stores/chat-typing.store';
import { initChatSync } from './chat-sync';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** Мінімальний фейковий сокет: зберігає обробники по імені події й дає їх викликати */
function createFakeSocket(): {
  socket: AppSocket;
  fire: (event: string, payload?: unknown) => void;
  setRecovered: (value: boolean) => void;
} {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const socket = {
    on: (event: string, handler: (payload: unknown) => void): AppSocket => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return socket as unknown as AppSocket;
    },
    recovered: false,
  };
  return {
    socket: socket as unknown as AppSocket,
    fire: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
    setRecovered: (value) => {
      socket.recovered = value;
    },
  };
}

function created(seq: number, clientMessageId: string | null = null): ChatMessageCreated {
  return {
    conversationId: CONVERSATION,
    occurredAt: '2026-01-01T00:00:00.000Z',
    message: {
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
      clientMessageId,
      direction: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failure: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    },
  };
}

function changed(
  change: ChatConversationChanged['change'],
  conversationId = CONVERSATION,
): ChatConversationChanged {
  return { conversationId, change, occurredAt: '2026-01-01T00:00:00.000Z' };
}

function seedTranscript(queryClient: QueryClient, newestSeq: number): void {
  const data: InfiniteData<ChatMessageListResponseDtoOutput, string | undefined> = {
    pages: [{ items: [created(newestSeq).message], nextCursor: null }],
    pageParams: [undefined],
  };
  queryClient.setQueryData(transcriptKey(CONVERSATION), data);
}

function newestSeq(queryClient: QueryClient): number | undefined {
  return queryClient.getQueryData<InfiniteData<ChatMessageListResponseDtoOutput>>(
    transcriptKey(CONVERSATION),
  )?.pages[0]?.items[0]?.seq;
}

describe('initChatSync', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useChatOutboxStore.setState({ pending: {} });
  });

  it('patches the open transcript and re-reads the list on a new message', () => {
    seedTranscript(queryClient, 5);
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatMessageCreated, created(6));

    expect(newestSeq(queryClient)).toBe(6);
    // Список — персональні непрочитані й серверний порядок, патчити його не можна
    expect(invalidate).toHaveBeenCalledWith({ queryKey: conversationListKey() });
  });

  it('ignores a duplicate event for the transcript but still re-reads the list', () => {
    seedTranscript(queryClient, 5);
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatMessageCreated, created(5));

    expect(newestSeq(queryClient)).toBe(5);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('re-reads the transcript when the event reveals a gap', () => {
    seedTranscript(queryClient, 5);
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatMessageCreated, created(8));

    expect(newestSeq(queryClient)).toBe(5);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: transcriptKey(CONVERSATION) });
  });

  it('settles the author optimistic entry from the socket echo', () => {
    seedTranscript(queryClient, 5);
    useChatOutboxStore.getState().enqueue(CONVERSATION, 'hello', 'cid-1');
    const { socket, fire } = createFakeSocket();
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatMessageCreated, created(6, 'cid-1'));

    expect(useChatOutboxStore.getState().pending[CONVERSATION]).toBeUndefined();
    expect(newestSeq(queryClient)).toBe(6);
  });

  it('re-reads the list and the card when a conversation is created or its members change', () => {
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatConversationChanged, changed('created'));
    fire(REALTIME_EVENTS.chatConversationChanged, changed('membership', OTHER));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: conversationListKey() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatFindOneQueryKey(CONVERSATION) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatFindOneQueryKey(OTHER) });
  });

  it('message-updated signal: re-reads the transcript and the inbox, applies nothing itself', () => {
    queryClient.setQueryData(inboxKey('all'), { pages: [], pageParams: [] });
    seedTranscript(queryClient, 5);
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatMessageUpdated, {
      conversationId: CONVERSATION,
      messageId: '33333333-3333-4333-8333-333333333333',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: transcriptKey(CONVERSATION) });
    const filters = invalidate.mock.calls.find((call) => call[0]?.predicate)?.[0];
    const touchesInbox = queryClient
      .getQueryCache()
      .findAll({ predicate: filters?.predicate })
      .some((query) => JSON.stringify(query.queryKey) === JSON.stringify(inboxKey('all')));
    expect(touchesInbox).toBe(true);
    // стан доставки сигнал не несе: кеш стрічки не змінено напряму
    expect(newestSeq(queryClient)).toBe(5);
  });

  it('inbox signal: re-reads every inbox filter and the open conversation, and applies nothing itself', () => {
    queryClient.setQueryData(inboxKey('all'), { pages: [], pageParams: [] });
    queryClient.setQueryData(inboxKey('mine'), { pages: [], pageParams: [] });
    seedTranscript(queryClient, 5);
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    const signal: ChatInboxChanged = {
      conversationId: CONVERSATION,
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    fire(REALTIME_EVENTS.chatInboxChanged, signal);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: transcriptKey(CONVERSATION) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatFindOneQueryKey(CONVERSATION) });
    // перший виклик — предикат по префіксу скриньки: він зачіпає ВСІ фільтри, а не один
    const filters = invalidate.mock.calls[0]?.[0];
    const matches = (queryKey: readonly unknown[]): boolean =>
      queryClient
        .getQueryCache()
        .findAll({ predicate: filters?.predicate })
        .some((query) => JSON.stringify(query.queryKey) === JSON.stringify(queryKey));
    expect(matches(inboxKey('all'))).toBe(true);
    expect(matches(inboxKey('mine'))).toBe(true);
    expect(matches(conversationListKey())).toBe(false);
    // транскрипт не змінено напряму: сигнал не несе повідомлення
    expect(newestSeq(queryClient)).toBe(5);
  });

  it('re-reads only the list when the reader moved the cursor in another tab', () => {
    const { socket, fire } = createFakeSocket();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initChatSync(queryClient, socket);

    fire(REALTIME_EVENTS.chatConversationChanged, changed('read'));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: conversationListKey() });
  });

  it('re-reads every chat query after a reconnect that did not recover the session', () => {
    queryClient.setQueryData(conversationListKey(), { pages: [], pageParams: [] });
    seedTranscript(queryClient, 5);
    queryClient.setQueryData(['/api/customers'], { items: [] });
    const { socket, fire, setRecovered } = createFakeSocket();
    initChatSync(queryClient, socket);

    setRecovered(false);
    fire('connect');

    expect(queryClient.getQueryState(conversationListKey())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(transcriptKey(CONVERSATION))?.isInvalidated).toBe(true);
    // Чужі запити лишаються недоторканими
    expect(queryClient.getQueryState(['/api/customers'])?.isInvalidated).toBe(false);
  });

  it('trusts the events after a reconnect that recovered the session', () => {
    seedTranscript(queryClient, 5);
    const { socket, fire, setRecovered } = createFakeSocket();
    initChatSync(queryClient, socket);

    setRecovered(true);
    fire('connect');

    expect(queryClient.getQueryState(transcriptKey(CONVERSATION))?.isInvalidated).toBe(false);
  });

  describe('typing', () => {
    const ME = '33333333-3333-4333-8333-333333333333';
    const ALICE = '44444444-4444-4444-8444-444444444444';

    const typingEvent = (userId: string): ChatTypingChanged => ({
      conversationId: CONVERSATION,
      userId,
      expiresInMs: 6_000,
    });

    beforeEach(() => {
      useChatTypingStore.setState({ entries: {} });
      useAuthStore.setState({ user: { id: ME } as never });
    });

    it('records a colleague typing without touching the query cache', () => {
      const { socket, fire } = createFakeSocket();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
      initChatSync(queryClient, socket);

      fire(REALTIME_EVENTS.chatTypingChanged, typingEvent(ALICE));

      expect(Object.keys(useChatTypingStore.getState().entries[CONVERSATION] ?? {})).toEqual([
        ALICE,
      ]);
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('drops the echo of the user’s own typing from another tab', () => {
      const { socket, fire } = createFakeSocket();
      initChatSync(queryClient, socket);

      fire(REALTIME_EVENTS.chatTypingChanged, typingEvent(ME));

      expect(useChatTypingStore.getState().entries).toEqual({});
    });

    it('clears a typist the moment their message arrives', () => {
      useChatTypingStore.getState().pulse(CONVERSATION, ALICE, 6_000);
      const { socket, fire } = createFakeSocket();
      vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
      initChatSync(queryClient, socket);

      const event = created(6);
      fire(REALTIME_EVENTS.chatMessageCreated, {
        ...event,
        message: { ...event.message, senderId: ALICE },
      });

      expect(useChatTypingStore.getState().entries).toEqual({});
    });
  });
});
