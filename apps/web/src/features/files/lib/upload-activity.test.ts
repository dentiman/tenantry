import { describe, expect, it, vi } from 'vitest';
import { createLeaveGuard, toActivityItem, uploadSteps } from './upload-activity';
import type { UploadEntry } from './upload-queue';

type Entry = UploadEntry<{ name: string; size: number }, string>;

const entry = (patch: Partial<Entry> = {}): Entry => ({
  id: 'u1',
  source: { name: 'photo.png', size: 200 },
  phase: 'transferring',
  loaded: 50,
  total: 200,
  retryable: false,
  startedAt: 7,
  ...patch,
});

const label = (key: string): string => key;
const statuses = (e: Entry): string[] => uploadSteps(e, label).map((s) => s.status);
const actions = () => ({ cancel: vi.fn(), retry: vi.fn(), remove: vi.fn() });

describe('uploadSteps', () => {
  it('follows the upload through its three stages', () => {
    expect(statuses(entry({ phase: 'queued' }))).toEqual(['pending', 'pending', 'pending']);
    expect(statuses(entry({ phase: 'preparing' }))).toEqual(['running', 'pending', 'pending']);
    expect(statuses(entry({ phase: 'transferring' }))).toEqual(['done', 'running', 'pending']);
    expect(statuses(entry({ phase: 'verifying' }))).toEqual(['done', 'done', 'running']);
    expect(statuses(entry({ phase: 'done' }))).toEqual(['done', 'done', 'done']);
  });

  it('gives measurable progress only to the transfer step', () => {
    const steps = uploadSteps(entry(), label);
    expect(steps[1]).toMatchObject({ status: 'running', current: 50, total: 200 });
    expect(uploadSteps(entry({ phase: 'verifying' }), label)[2]?.total).toBeUndefined();
  });

  it('marks the stage that failed and keeps the earlier ones done', () => {
    const steps = uploadSteps(
      entry({ phase: 'failed', failedPhase: 'verifying', errorMessage: 'Not an image' }),
      label,
    );
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'failed']);
    expect(steps[2]?.description).toBe('Not an image');
  });
});

describe('toActivityItem', () => {
  it('describes an active upload with byte progress and a cancel action', () => {
    const a = actions();
    const item = toActivityItem(entry(), a, label);

    expect(item).toMatchObject({
      id: 'u1',
      title: 'photo.png',
      status: 'running',
      progress: { current: 50, total: 200 },
      startedAt: 7,
    });
    expect(item.onRetry).toBeUndefined();
    item.onCancel?.();
    expect(a.cancel).toHaveBeenCalledWith('u1');
  });

  it('a waiting upload counts with zero bytes of its full size', () => {
    const item = toActivityItem(entry({ phase: 'queued', loaded: 0 }), actions(), label);
    expect(item).toMatchObject({ status: 'queued', progress: { current: 0, total: 200 } });
  });

  it('offers retry only for a failed upload whose originator allowed it', () => {
    const failed = { phase: 'failed', failedPhase: 'transferring', errorMessage: 'Lost' } as const;
    const a = actions();

    expect(toActivityItem(entry(failed), a, label).onRetry).toBeUndefined();
    const item = toActivityItem(entry({ ...failed, retryable: true }), a, label);
    expect(item).toMatchObject({ status: 'failed', errorMessage: 'Lost' });
    expect(item.progress).toBeUndefined();
    expect(item.onCancel).toBeUndefined();
    item.onRetry?.();
    expect(a.retry).toHaveBeenCalledWith('u1');
  });

  it('dismissing removes the upload, cancelling it first if it is still active', () => {
    const finished = actions();
    toActivityItem(entry({ phase: 'canceled' }), finished, label).onDismiss();
    expect(finished.cancel).not.toHaveBeenCalled();
    expect(finished.remove).toHaveBeenCalledWith('u1');

    const running = actions();
    toActivityItem(entry(), running, label).onDismiss();
    expect(running.cancel).toHaveBeenCalledWith('u1');
    expect(running.remove).toHaveBeenCalledWith('u1');
  });
});

describe('createLeaveGuard', () => {
  it('listens for leaving only while uploads are active', () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const sync = createLeaveGuard(target);

    sync(0);
    expect(target.addEventListener).not.toHaveBeenCalled();
    sync(2);
    sync(1);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    sync(0);
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener.mock.calls[0]?.[1]).toBe(
      target.addEventListener.mock.calls[0]?.[1],
    );
  });

  it('asks the browser to confirm leaving', () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    createLeaveGuard(target)(1);
    const listener = target.addEventListener.mock.calls[0]?.[1] as (e: BeforeUnloadEvent) => void;
    const event = { preventDefault: vi.fn() };
    listener(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
