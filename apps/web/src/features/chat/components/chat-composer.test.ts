import { describe, expect, it } from 'vitest';
import { CHAT_TYPING_PULSE_MS } from '@saas-skeleton/contracts';
import { shouldPulseTyping, shouldSendOnKey } from './chat-composer';

/**
 * Правило клавіатури композера. Тест на функції, а не на компоненті: раннер
 * працює без DOM (`vitest.config.ts`), а зламати тут можна саме умову.
 */
describe('shouldSendOnKey', () => {
  it('sends on a plain Enter', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
  });

  it('inserts a line break on Shift+Enter', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
  });

  it('leaves Enter to the input method while composing', () => {
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
  });

  it('ignores every other key', () => {
    expect(shouldSendOnKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});

/** Імпульс «друкую»: лише для непорожнього вводу і не частіше за інтервал */
describe('shouldPulseTyping', () => {
  it('pulses at the first keystroke of a non-empty value', () => {
    expect(shouldPulseTyping(null, 1_000, 'h')).toBe(true);
  });

  it('does not pulse for an empty or whitespace-only value', () => {
    expect(shouldPulseTyping(null, 1_000, '')).toBe(false);
    expect(shouldPulseTyping(null, 1_000, '   ')).toBe(false);
  });

  it('stays silent inside the interval', () => {
    expect(shouldPulseTyping(1_000, 1_000 + CHAT_TYPING_PULSE_MS - 1, 'hello')).toBe(false);
  });

  it('pulses again once the interval has passed', () => {
    expect(shouldPulseTyping(1_000, 1_000 + CHAT_TYPING_PULSE_MS, 'hello')).toBe(true);
  });

  it('pulses again straight after a send resets the interval', () => {
    // Після надсилання композер скидає `lastPulseAt` у null, тож новий набір починає з імпульсу
    expect(shouldPulseTyping(null, 1_500, 'next message')).toBe(true);
  });
});
