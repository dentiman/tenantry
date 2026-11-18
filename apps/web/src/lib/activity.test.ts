import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUCCEEDED_LINGER_MS,
  summarizeActivity,
  useActivityStore,
  type ActivityItem,
} from './activity';

function item(patch: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    title: patch.id,
    status: 'running',
    startedAt: 0,
    // Джерело забирає елемент у себе й прибирає з реєстру — як це робить черга завантажень
    onDismiss: () => {
      useActivityStore.getState().remove(patch.id);
    },
    ...patch,
  };
}

const ids = (): string[] => useActivityStore.getState().items.map((i) => i.id);

describe('activity registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useActivityStore.setState({ items: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the newest item first and replaces an item by id', () => {
    const { upsert } = useActivityStore.getState();
    upsert(item({ id: 'old', startedAt: 1 }));
    upsert(item({ id: 'new', startedAt: 2 }));
    upsert(item({ id: 'old', startedAt: 1, status: 'failed' }));

    expect(ids()).toEqual(['new', 'old']);
    expect(useActivityStore.getState().items[1]?.status).toBe('failed');
  });

  it('removes a succeeded item by itself after a short while', () => {
    useActivityStore.getState().upsert(item({ id: 'a', status: 'succeeded' }));

    vi.advanceTimersByTime(SUCCEEDED_LINGER_MS - 1);
    expect(ids()).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it('keeps a succeeded item that offers an action until it is dismissed', () => {
    useActivityStore
      .getState()
      .upsert(item({ id: 'export', status: 'succeeded', action: { label: 'Download', run: () => undefined } }));

    vi.advanceTimersByTime(SUCCEEDED_LINGER_MS * 10);
    expect(ids()).toEqual(['export']);
  });

  it('keeps failed and cancelled items until they are dismissed', () => {
    const { upsert } = useActivityStore.getState();
    upsert(item({ id: 'failed', status: 'failed' }));
    upsert(item({ id: 'canceled', status: 'canceled' }));

    vi.advanceTimersByTime(SUCCEEDED_LINGER_MS * 10);
    expect(ids().sort()).toEqual(['canceled', 'failed']);
  });

  it('does not remove an item that was restarted before the timer fired', () => {
    const { upsert } = useActivityStore.getState();
    upsert(item({ id: 'a', status: 'succeeded' }));
    upsert(item({ id: 'a', status: 'running' }));

    vi.advanceTimersByTime(SUCCEEDED_LINGER_MS * 2);
    expect(ids()).toEqual(['a']);
  });
});

describe('summarizeActivity', () => {
  it('combines the progress of active items by size, not by count', () => {
    const summary = summarizeActivity([
      item({ id: 'big', progress: { current: 50, total: 900 } }),
      item({ id: 'small', progress: { current: 100, total: 100 } }),
    ]);
    expect(summary).toEqual({ active: 2, failed: 0, succeeded: 0, percent: 15 });
  });

  it('counts queued items as active and ignores finished ones in the percentage', () => {
    const summary = summarizeActivity([
      item({ id: 'q', status: 'queued', progress: { current: 0, total: 100 } }),
      item({ id: 'r', progress: { current: 50, total: 100 } }),
      item({ id: 'done', status: 'succeeded', progress: { current: 100, total: 100 } }),
      item({ id: 'bad', status: 'failed' }),
    ]);
    expect(summary).toEqual({ active: 2, failed: 1, succeeded: 1, percent: 25 });
  });

  it('reports no percentage when nothing measurable is active', () => {
    expect(summarizeActivity([item({ id: 'a' })]).percent).toBeNull();
    expect(summarizeActivity([]).percent).toBeNull();
  });
});
