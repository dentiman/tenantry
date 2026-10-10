import { describe, expect, it, vi } from 'vitest';
import { CLIENT_EVENTS } from '@saas-skeleton/contracts';
import { emitChatEvent, reportRead } from './chat-socket';

/**
 * Ack-хелпер чату (design.md D5/D7, фаза 0.2b): відмова чи таймаут не кидають — усе, що чат
 * робить через сокет, прискорення, і екран без нього лишається робочим.
 */

interface Behaviour {
  connected?: boolean;
  ack?: unknown;
  reject?: boolean;
}

function fakeSocket({
  connected = true,
  ack = { ok: true, data: {} },
  reject = false,
}: Behaviour = {}) {
  const calls: { event: string; payload: unknown }[] = [];
  const socket = {
    connected,
    timeout: () => ({
      emitWithAck: (event: string, payload: unknown): Promise<unknown> => {
        calls.push({ event, payload });
        return reject ? Promise.reject(new Error('operation has timed out')) : Promise.resolve(ack);
      },
    }),
  };
  return { socket, calls };
}

describe('emitChatEvent', () => {
  it('passes the server acknowledgement through', async () => {
    const { socket, calls } = fakeSocket({ ack: { ok: true, data: { conversationId: 'c1' } } });

    const ack = await emitChatEvent(CLIENT_EVENTS.chatSubscribe, { conversationId: 'c1' }, socket);

    expect(ack).toEqual({ ok: true, data: { conversationId: 'c1' } });
    expect(calls).toEqual([{ event: 'chat.subscribe.v1', payload: { conversationId: 'c1' } }]);
  });

  it('passes a refusal through unchanged', async () => {
    const { socket } = fakeSocket({ ack: { ok: false, code: 'NOT_FOUND' } });

    expect(await emitChatEvent(CLIENT_EVENTS.chatSubscribe, {}, socket)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('does not emit at all while the socket is not connected', async () => {
    const { socket, calls } = fakeSocket({ connected: false });

    const ack = await emitChatEvent(CLIENT_EVENTS.chatTyping, {}, socket);

    // Socket.IO інакше буферизував би подію до наступного підключення
    expect(ack).toEqual({ ok: false, code: 'INTERNAL' });
    expect(calls).toHaveLength(0);
  });

  it('turns a timeout into a refusal instead of throwing', async () => {
    const { socket } = fakeSocket({ reject: true });

    expect(await emitChatEvent(CLIENT_EVENTS.chatRead, {}, socket)).toEqual({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('treats a malformed acknowledgement as a refusal', async () => {
    const { socket } = fakeSocket({ ack: 'garbage' });

    expect(await emitChatEvent(CLIENT_EVENTS.chatRead, {}, socket)).toEqual({
      ok: false,
      code: 'INTERNAL',
    });
  });
});

describe('reportRead', () => {
  it('uses the socket and never the REST fallback when the server acknowledges', async () => {
    const { socket, calls } = fakeSocket();
    const fallback = vi.fn();

    await reportRead('c1', 7, fallback, socket);

    expect(calls).toEqual([{ event: 'chat.read.v1', payload: { conversationId: 'c1', seq: 7 } }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to REST when the socket is not connected', async () => {
    const { socket } = fakeSocket({ connected: false });
    const fallback = vi.fn();

    await reportRead('c1', 7, fallback, socket);

    expect(fallback).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('falls back to REST when the server refuses', async () => {
    const { socket } = fakeSocket({ ack: { ok: false, code: 'RATE_LIMITED' } });
    const fallback = vi.fn();

    await reportRead('c1', 7, fallback, socket);

    expect(fallback).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('falls back to REST on a timeout', async () => {
    const { socket } = fakeSocket({ reject: true });
    const fallback = vi.fn();

    await reportRead('c1', 7, fallback, socket);

    expect(fallback).toHaveBeenCalledExactlyOnceWith(7);
  });
});
