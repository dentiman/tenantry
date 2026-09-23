import { describe, expect, it } from 'vitest';
import { shouldSendOnKey } from './chat-composer';

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
