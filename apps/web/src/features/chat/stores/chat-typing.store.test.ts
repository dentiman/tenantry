import { beforeEach, describe, expect, it } from 'vitest';
import { activeTypists, useChatTypingStore } from './chat-typing.store';

/**
 * «Хто друкує»: локальний дедлайн від відносного терміну, миттєве гасіння, прибирання
 * простроченого (design.md D4/D8, фаза 0.2b).
 */
describe('chat typing store', () => {
  beforeEach(() => {
    useChatTypingStore.setState({ entries: {} });
  });

  it('records a deadline as receipt time plus the relative expiry', () => {
    useChatTypingStore.getState().pulse('c1', 'alice', 6_000, 1_000);

    expect(useChatTypingStore.getState().entries).toEqual({ c1: { alice: 7_000 } });
  });

  it('renews a deadline on the next pulse instead of stacking', () => {
    const { pulse } = useChatTypingStore.getState();
    pulse('c1', 'alice', 6_000, 1_000);
    pulse('c1', 'alice', 6_000, 4_000);

    expect(useChatTypingStore.getState().entries).toEqual({ c1: { alice: 10_000 } });
  });

  it('lists only typists whose deadline has not passed', () => {
    const { pulse } = useChatTypingStore.getState();
    pulse('c1', 'alice', 6_000, 1_000); // до 7000
    pulse('c1', 'bob', 1_000, 1_000); // до 2000

    expect(activeTypists(useChatTypingStore.getState().entries, 'c1', 3_000)).toEqual(['alice']);
    expect(activeTypists(useChatTypingStore.getState().entries, 'c1', 8_000)).toEqual([]);
    expect(activeTypists(useChatTypingStore.getState().entries, 'other', 3_000)).toEqual([]);
  });

  it('clears one typist at once and drops an emptied conversation', () => {
    const { pulse, clear } = useChatTypingStore.getState();
    pulse('c1', 'alice', 6_000, 1_000);
    pulse('c1', 'bob', 6_000, 1_000);

    clear('c1', 'alice');
    expect(useChatTypingStore.getState().entries).toEqual({ c1: { bob: 7_000 } });

    clear('c1', 'bob');
    expect(useChatTypingStore.getState().entries).toEqual({});
  });

  it('ignores clearing someone who is not typing', () => {
    useChatTypingStore.getState().pulse('c1', 'alice', 6_000, 1_000);
    const before = useChatTypingStore.getState().entries;

    useChatTypingStore.getState().clear('c1', 'nobody');
    useChatTypingStore.getState().clear('missing', 'alice');

    expect(useChatTypingStore.getState().entries).toBe(before);
  });

  it('prunes lapsed entries and keeps the live ones', () => {
    const { pulse, prune } = useChatTypingStore.getState();
    pulse('c1', 'alice', 6_000, 1_000); // до 7000
    pulse('c1', 'bob', 1_000, 1_000); // до 2000
    pulse('c2', 'carol', 1_000, 1_000); // до 2000

    prune(3_000);

    expect(useChatTypingStore.getState().entries).toEqual({ c1: { alice: 7_000 } });
  });

  it('leaves the state object untouched when nothing has lapsed', () => {
    useChatTypingStore.getState().pulse('c1', 'alice', 6_000, 1_000);
    const before = useChatTypingStore.getState().entries;

    useChatTypingStore.getState().prune(2_000);

    expect(useChatTypingStore.getState().entries).toBe(before);
  });
});
