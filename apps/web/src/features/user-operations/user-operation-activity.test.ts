import { describe, expect, it, vi } from 'vitest';
import type { UserOperationResponse } from '@saas-skeleton/contracts';
import { isNewerRevision, toActivityItem } from './user-operation-activity';

const operation = (patch: Partial<UserOperationResponse> = {}): UserOperationResponse => ({
  id: 'op-1',
  type: 'customers.export',
  title: 'customers-2026-11-18.csv',
  status: 'RUNNING',
  progress: { current: 40, total: 100 },
  steps: null,
  revision: 3,
  result: null,
  hasResultFile: false,
  errorCode: null,
  cancelRequested: false,
  createdAt: '2026-11-18T10:00:00.000Z',
  startedAt: '2026-11-18T10:00:01.000Z',
  finishedAt: null,
  ...patch,
});

const texts = {
  step: (type: string, key: string) => `${type}:${key}`,
  error: (code: string) => `error:${code}`,
  download: 'Download',
};
const actions = () => ({ cancel: vi.fn(), dismiss: vi.fn(), download: vi.fn() });

describe('toActivityItem', () => {
  it('a running operation shows its progress and offers cancel', () => {
    const a = actions();
    const item = toActivityItem(operation(), a, texts);
    expect(item).toMatchObject({
      id: 'op-1',
      title: 'customers-2026-11-18.csv',
      status: 'running',
      progress: { current: 40, total: 100 },
      startedAt: Date.parse('2026-11-18T10:00:00.000Z'),
    });
    expect(item.action).toBeUndefined();
    item.onCancel?.();
    expect(a.cancel).toHaveBeenCalledWith('op-1');
  });

  it('does not offer cancel twice once it was requested', () => {
    expect(toActivityItem(operation({ cancelRequested: true }), actions(), texts).onCancel).toBeUndefined();
  });

  it('a succeeded operation with a file offers download and keeps no progress', () => {
    const a = actions();
    const item = toActivityItem(
      operation({ status: 'SUCCEEDED', hasResultFile: true, progress: { current: 100, total: 100 } }),
      a,
      texts,
    );
    expect(item.status).toBe('succeeded');
    expect(item.progress).toBeUndefined();
    expect(item.onCancel).toBeUndefined();
    expect(item.action?.label).toBe('Download');
    item.action?.run();
    expect(a.download).toHaveBeenCalledWith('op-1');
  });

  it('a succeeded operation without a file has no action', () => {
    expect(toActivityItem(operation({ status: 'SUCCEEDED' }), actions(), texts).action).toBeUndefined();
  });

  it('a failed operation carries the translated error code', () => {
    const item = toActivityItem(operation({ status: 'FAILED', errorCode: 'STALLED' }), actions(), texts);
    expect(item).toMatchObject({ status: 'failed', errorMessage: 'error:STALLED' });
  });

  it('labels steps through the type texts', () => {
    const item = toActivityItem(
      operation({ steps: [{ key: 'validate', status: 'running', current: 3, total: 9 }] }),
      actions(),
      texts,
    );
    expect(item.steps?.[0]).toMatchObject({
      label: 'customers.export:validate',
      status: 'running',
      current: 3,
      total: 9,
    });
  });
});

describe('isNewerRevision', () => {
  it('re-reads only for a revision newer than the known one', () => {
    expect(isNewerRevision(undefined, 0)).toBe(true);
    expect(isNewerRevision(3, 4)).toBe(true);
    expect(isNewerRevision(3, 3)).toBe(false);
    expect(isNewerRevision(3, 2)).toBe(false);
  });
});
