import { describe, expect, it } from 'vitest';
import type { OutboxMessage } from '../stores/chat-outbox.store';
import { buildRows, isOwnRow, type Row } from './chat-transcript';
import type { ChatMessage } from './use-chat';

/**
 * Страховка від подвійного рядка (design.md D4, фаза 0.2a): відлуння сокета або перечитана
 * стрічка вже принесли підтверджену репліку, а запис у черзі вихідних ще не зняли.
 */

function message(seq: number, clientMessageId: string | null): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    conversationId: '11111111-1111-4111-8111-111111111111',
    seq,
    kind: 'TEXT',
    visibility: 'PUBLIC',
    status: 'SENT',
    senderType: 'user',
    senderId: '33333333-3333-4333-8333-333333333333',
    senderLabel: 'Alice',
    body: `message ${String(seq)}`,
    payload: {},
    clientMessageId,
    direction: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failure: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    deletedAt: null,
  };
}

function pending(clientMessageId: string): OutboxMessage {
  return {
    clientMessageId,
    body: 'text',
    state: 'sending',
    createdAt: '2026-01-01T10:00:01.000Z',
    visibility: 'PUBLIC',
  };
}

describe('buildRows', () => {
  it('draws a pending entry after the last server message', () => {
    const rows = buildRows([message(1, null)], [pending('cid-1')]);

    expect(rows.at(-1)).toMatchObject({ kind: 'outbox', key: 'outbox-cid-1' });
  });

  it('does not draw a pending entry the transcript already confirmed', () => {
    const rows = buildRows([message(1, null), message(2, 'cid-1')], [pending('cid-1')]);

    expect(rows.filter((row) => row.kind === 'outbox')).toHaveLength(0);
    expect(rows.filter((row) => row.kind === 'message')).toHaveLength(2);
  });

  it('keeps the entries that are still unconfirmed', () => {
    const rows = buildRows([message(1, 'cid-1')], [pending('cid-1'), pending('cid-2')]);

    expect(rows.filter((row) => row.kind === 'outbox').map((row) => row.key)).toEqual([
      'outbox-cid-2',
    ]);
  });
});

/**
 * Власна репліка (design.md D6, фаза 0.2b): її стрічка докручує до кінця явно, бо примітив у
 * режимі «слідувати за низом» не змінює позицію того, хто прогорнув історію вгору.
 */
describe('isOwnRow', () => {
  const VIEWER = '33333333-3333-4333-8333-333333333333';
  const OTHER = '99999999-9999-4999-8999-999999999999';
  const row = (entry: ChatMessage): Row => ({
    kind: 'message',
    key: entry.id,
    message: entry,
    groupedWithPrevious: false,
  });

  it('recognises an unsent entry from the outbox as the reader’s own', () => {
    expect(isOwnRow({ kind: 'outbox', key: 'outbox-1', entry: pending('cid-1') }, VIEWER)).toBe(
      true,
    );
  });

  it('recognises a confirmed message by its sender', () => {
    expect(isOwnRow(row({ ...message(6, null), senderId: VIEWER }), VIEWER)).toBe(true);
    expect(isOwnRow(row({ ...message(5, null), senderId: OTHER }), VIEWER)).toBe(false);
  });

  it('never treats a date divider or a system entry as the reader’s own', () => {
    expect(isOwnRow({ kind: 'day', key: 'day-1', label: 'Today' }, VIEWER)).toBe(false);
    expect(isOwnRow(row({ ...message(7, null), kind: 'SYSTEM', senderId: VIEWER }), VIEWER)).toBe(
      false,
    );
  });
});
