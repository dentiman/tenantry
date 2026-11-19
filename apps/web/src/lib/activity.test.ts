import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityHeadline,
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
    useActivityStore.setState({ items: [], collapsed: false });
  });

  it('keeps the newest item first and replaces an item by id', () => {
    const { upsert } = useActivityStore.getState();
    upsert(item({ id: 'old', startedAt: 1 }));
    upsert(item({ id: 'new', startedAt: 2 }));
    upsert(item({ id: 'old', startedAt: 1, status: 'failed' }));

    expect(ids()).toEqual(['new', 'old']);
    expect(useActivityStore.getState().items[1]?.status).toBe('failed');
  });

  it('keeps finished items until the dock is closed', () => {
    vi.useFakeTimers();
    const { upsert } = useActivityStore.getState();
    upsert(item({ id: 'done', status: 'succeeded' }));
    upsert(item({ id: 'failed', status: 'failed' }));

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(ids().sort()).toEqual(['done', 'failed']);
    vi.useRealTimers();
  });

  it('closing the dock cancels what is active and removes everything', () => {
    const cancel = vi.fn();
    const cancelFinished = vi.fn();
    const { upsert, closeAll } = useActivityStore.getState();
    upsert(item({ id: 'running', onCancel: cancel }));
    upsert(item({ id: 'queued', status: 'queued', onCancel: cancel }));
    upsert(item({ id: 'done', status: 'succeeded', onCancel: cancelFinished }));

    closeAll();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancelFinished).not.toHaveBeenCalled();
    expect(ids()).toEqual([]);
  });

  it('reveal expands a collapsed dock and leaves an expanded one alone', () => {
    const store = useActivityStore.getState();
    store.setCollapsed(true);
    expect(useActivityStore.getState().collapsed).toBe(true);
    store.reveal();
    expect(useActivityStore.getState().collapsed).toBe(false);
  });
});

describe('activityHeadline', () => {
  it('names uploads when only uploads are active', () => {
    expect(
      activityHeadline([
        item({ id: 'a', kind: 'upload', progress: { current: 50, total: 100 } }),
        item({ id: 'b', kind: 'upload', status: 'queued', progress: { current: 0, total: 100 } }),
        item({ id: 'old', kind: 'operation', status: 'succeeded' }),
      ]),
    ).toEqual({ tone: 'active', uploadsOnly: true, count: 2, percent: 25 });
  });

  it('speaks generally about a mixed active set', () => {
    expect(
      activityHeadline([item({ id: 'a', kind: 'upload' }), item({ id: 'b', kind: 'operation' })]),
    ).toEqual({ tone: 'active', uploadsOnly: false, count: 2, percent: null });
  });

  it('puts failures before completions once nothing is active', () => {
    expect(
      activityHeadline([
        item({ id: 'a', status: 'failed' }),
        item({ id: 'b', status: 'succeeded' }),
      ]),
    ).toEqual({ tone: 'failed', count: 1 });
  });

  it('reports completions, and stays neutral when only cancelled items remain', () => {
    expect(
      activityHeadline([
        item({ id: 'a', kind: 'upload', status: 'succeeded' }),
        item({ id: 'b', kind: 'upload', status: 'succeeded' }),
        item({ id: 'c', status: 'canceled' }),
      ]),
    ).toEqual({ tone: 'done', uploadsOnly: true, count: 2 });
    expect(activityHeadline([item({ id: 'c', status: 'canceled' })])).toEqual({ tone: 'idle' });
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
