import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationWatcher } from './chat-subscriptions';

/**
 * Облік «розмова відкрита» (design.md D7, фаза 0.2b): лічильник посилань, відкладена відписка
 * проти StrictMode, перепідписка на кожен `connect` і мовчазна відмова.
 */

function fakeSocket(ack: unknown = { ok: true, data: {} }) {
  const calls: { event: string; payload: unknown }[] = [];
  const connectHandlers: (() => void)[] = [];
  const socket = {
    connected: true,
    on: (event: string, handler: () => void) => {
      if (event === 'connect') {
        connectHandlers.push(handler);
      }
      return socket;
    },
    timeout: () => ({
      emitWithAck: (event: string, payload: unknown): Promise<unknown> => {
        calls.push({ event, payload });
        return Promise.resolve(ack);
      },
    }),
  };
  return {
    socket: socket as never,
    calls,
    fireConnect: () => {
      for (const handler of connectHandlers) {
        handler();
      }
    },
    names: () => calls.map((call) => call.event),
  };
}

describe('createConversationWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes on the first hold and unsubscribes after the last release', () => {
    const { socket, names } = fakeSocket();
    const { watch } = createConversationWatcher(socket);

    const release = watch('c1');
    expect(names()).toEqual(['chat.subscribe.v1']);

    release();
    expect(names()).toEqual(['chat.subscribe.v1']); // відкладено на такт
    vi.runAllTimers();
    expect(names()).toEqual(['chat.subscribe.v1', 'chat.unsubscribe.v1']);
  });

  it('keeps the subscription while any holder remains', () => {
    const { socket, names } = fakeSocket();
    const { watch } = createConversationWatcher(socket);

    const first = watch('c1');
    const second = watch('c1');
    expect(names()).toEqual(['chat.subscribe.v1']); // друге утримання не шле нічого

    first();
    vi.runAllTimers();
    expect(names()).toEqual(['chat.subscribe.v1']);

    second();
    vi.runAllTimers();
    expect(names()).toEqual(['chat.subscribe.v1', 'chat.unsubscribe.v1']);
  });

  it('emits no unsubscribe/subscribe pair on a StrictMode mount-unmount-mount', () => {
    const { socket, names } = fakeSocket();
    const { watch } = createConversationWatcher(socket);

    const release = watch('c1'); // mount
    release(); // StrictMode unmount
    watch('c1'); // mount again, до спрацювання відкладеної відписки
    vi.runAllTimers();

    expect(names()).toEqual(['chat.subscribe.v1']);
  });

  it('releases only once even if the cleanup is called twice', () => {
    const { socket, names } = fakeSocket();
    const { watch } = createConversationWatcher(socket);
    const holder = watch('c1');
    watch('c1');

    holder();
    holder(); // другий виклик того самого cleanup не знімає чужого утримання
    vi.runAllTimers();

    expect(names()).toEqual(['chat.subscribe.v1']);
  });

  it('subscribes every held conversation again on each connect', () => {
    const { socket, calls, fireConnect } = fakeSocket();
    const { watch } = createConversationWatcher(socket);
    watch('c1');
    watch('c2');
    calls.length = 0;

    fireConnect();

    expect(calls).toEqual([
      { event: 'chat.subscribe.v1', payload: { conversationId: 'c1' } },
      { event: 'chat.subscribe.v1', payload: { conversationId: 'c2' } },
    ]);
  });

  it('does not resubscribe a conversation that was released before the reconnect', () => {
    const { socket, calls, fireConnect } = fakeSocket();
    const { watch } = createConversationWatcher(socket);
    const release = watch('c1');
    release();
    vi.runAllTimers();
    calls.length = 0;

    fireConnect();

    expect(calls).toHaveLength(0);
  });

  it('swallows a refusal: the screen keeps working', async () => {
    const { socket } = fakeSocket({ ok: false, code: 'NOT_FOUND' });
    const { watch } = createConversationWatcher(socket);

    expect(() => watch('c1')).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
