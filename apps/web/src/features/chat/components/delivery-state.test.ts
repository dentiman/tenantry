import { describe, expect, it } from 'vitest';
import { canResend, deliveryIcon, effectiveMode, failureKey, isDeliverable } from './delivery-state';
import type { ChatMessage } from './use-chat';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    conversationId: '11111111-1111-4111-8111-111111111111',
    seq: 2,
    kind: 'TEXT',
    visibility: 'PUBLIC',
    status: 'SENT',
    senderType: 'user',
    senderId: null,
    senderLabel: 'Alice',
    body: 'hi',
    payload: {},
    clientMessageId: null,
    direction: 'OUTBOUND',
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failure: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('deliveryIcon', () => {
  it.each([
    ['QUEUED', 'pending'],
    ['SENDING', 'pending'],
    ['SENT', 'sent'],
    ['DELIVERED', 'delivered'],
    ['READ', 'read'],
    ['FAILED', 'failed'],
  ] as const)('%s → %s', (status, icon) => {
    expect(deliveryIcon(status)).toBe(icon);
  });
});

describe('isDeliverable', () => {
  it('лише публічне вихідне; нотатка й вхідне — ні', () => {
    expect(isDeliverable(message({}))).toBe(true);
    expect(isDeliverable(message({ visibility: 'INTERNAL' }))).toBe(false);
    expect(isDeliverable(message({ direction: 'INBOUND' }))).toBe(false);
    expect(isDeliverable(message({ direction: null }))).toBe(false);
  });
});

describe('failureKey', () => {
  it('непідтверджена доставка має свій текст, решта — за класом', () => {
    expect(failureKey({ class: 'TRANSIENT', code: 'outcome_unknown', title: 't', unconfirmed: true })).toBe(
      'failure.unconfirmed',
    );
    expect(failureKey({ class: 'PERMANENT', code: '131026', title: 't' })).toBe('failure.PERMANENT');
  });
});

describe('canResend', () => {
  it('невдале вихідне — так', () => {
    expect(canResend(message({ status: 'FAILED', failure: { class: 'TRANSIENT', code: 'x', title: 't' } }))).toBe(true);
  });

  it('вікно закрите — ні (повтор дав би 422)', () => {
    expect(canResend(message({ status: 'FAILED', failure: { class: 'WINDOW_CLOSED', code: 'x', title: 't' } }))).toBe(false);
  });

  it('не невдале, нотатка, вхідне — ні', () => {
    expect(canResend(message({ status: 'SENT' }))).toBe(false);
    expect(canResend(message({ status: 'FAILED', visibility: 'INTERNAL' }))).toBe(false);
    expect(canResend(message({ status: 'FAILED', direction: 'INBOUND' }))).toBe(false);
  });
});

describe('effectiveMode', () => {
  it('закрите вікно примушує до нотатки, відкрите поважає вибір', () => {
    expect(effectiveMode('reply', true)).toBe('reply');
    expect(effectiveMode('reply', false)).toBe('note');
    expect(effectiveMode('note', true)).toBe('note');
  });
});
