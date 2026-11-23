import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_HEADER,
  attachIdempotencyKey,
  createIdempotencyKeys,
  isDefiniteOutcome,
  settleIdempotencyKey,
} from './idempotency';

function sequentialKeys(options: { now?: () => number; ttlMs?: number } = {}) {
  let counter = 0;
  return createIdempotencyKeys({ ...options, newKey: () => `key-${String((counter += 1))}` });
}

function headerBag(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => values.set(name, value),
  };
}

const create = { method: 'post', url: '/api/customers', data: { name: 'Acme' } };

describe('idempotency keys of the web client', () => {
  it('a double submit reuses the key while the first attempt is in flight', () => {
    const keys = sequentialKeys();
    expect(keys.keyFor(create)).toBe('key-1');
    expect(keys.keyFor(create)).toBe('key-1');
  });

  it('a retry after a lost response reuses the key', () => {
    const keys = sequentialKeys();
    const key = keys.keyFor(create);
    keys.settle(key ?? '', { status: null });
    expect(keys.keyFor(create)).toBe(key);
  });

  it('a deliberate second record after a success gets a new key', () => {
    const keys = sequentialKeys();
    const key = keys.keyFor(create);
    keys.settle(key ?? '', { status: 201 });
    expect(keys.keyFor(create)).toBe('key-2');
  });

  it('a corrected form after a rejection gets a new key', () => {
    const keys = sequentialKeys();
    const key = keys.keyFor({ ...create, data: { name: '' } });
    keys.settle(key ?? '', { status: 400, code: 'VALIDATION_ERROR' });
    expect(keys.keyFor({ ...create, data: { name: 'Acme' } })).toBe('key-2');
    // …і та сама невиправлена форма після відмови — теж нова спроба
    expect(keys.keyFor({ ...create, data: { name: '' } })).toBe('key-3');
  });

  it('different requests never share a key', () => {
    const keys = sequentialKeys();
    const first = keys.keyFor(create);
    expect(keys.keyFor({ ...create, data: { name: 'Other' } })).not.toBe(first);
    expect(keys.keyFor({ ...create, url: '/api/calendar/events' })).not.toBe(first);
    expect(keys.keyFor({ ...create, params: { dryRun: true } })).not.toBe(first);
  });

  it('keeps the key when the outcome is not definite', () => {
    for (const outcome of [
      { status: 500 },
      { status: 503 },
      { status: 401 },
      { status: 408 },
      { status: 429 },
      { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' },
    ]) {
      const keys = sequentialKeys();
      const key = keys.keyFor(create);
      keys.settle(key ?? '', outcome);
      expect(keys.keyFor(create)).toBe(key);
      expect(isDefiniteOutcome(outcome)).toBe(false);
    }
  });

  it('forgets the key on any definite answer', () => {
    for (const outcome of [
      { status: 200 },
      { status: 204 },
      { status: 403 },
      { status: 404 },
      { status: 409, code: 'CONFLICT' },
      { status: 422, code: 'IDEMPOTENCY_KEY_REUSED' },
    ]) {
      expect(isDefiniteOutcome(outcome)).toBe(true);
    }
  });

  it('an unanswered attempt stops being retried with the same key after the time limit', () => {
    let time = 0;
    const keys = sequentialKeys({ now: () => time, ttlMs: 1000 });
    expect(keys.keyFor(create)).toBe('key-1');
    time = 999;
    expect(keys.keyFor(create)).toBe('key-1');
    time = 1000;
    expect(keys.keyFor(create)).toBe('key-2');
  });

  it('only protects POST requests with a JSON body', () => {
    const keys = sequentialKeys();
    expect(keys.keyFor({ ...create, method: 'patch' })).toBeUndefined();
    expect(keys.keyFor({ method: 'post', url: '/api/files/1/complete' })).toBeUndefined();
    expect(keys.keyFor({ ...create, data: new URLSearchParams({ a: '1' }) })).toBeUndefined();
    expect(keys.keyFor({ ...create, data: new Uint8Array(2) })).toBeUndefined();
    expect(keys.keyFor({ ...create, data: [{ id: 1 }] })).toBe('key-1');
  });

  it('a body already serialized by axios matches the original object', () => {
    // Повтор після refresh токена приходить в інтерсептор уже з рядком у `data`
    const keys = sequentialKeys();
    const key = keys.keyFor(create);
    expect(keys.keyFor({ ...create, data: JSON.stringify(create.data) })).toBe(key);
  });
});

describe('axios adapters', () => {
  it('sets the header and settles it from the response config', () => {
    const keys = sequentialKeys();
    const headers = headerBag();
    attachIdempotencyKey(keys, { ...create, headers });
    expect(headers.get(IDEMPOTENCY_KEY_HEADER)).toBe('key-1');

    settleIdempotencyKey(keys, { headers }, { status: 201 });
    expect(keys.keyFor(create)).toBe('key-2');
  });

  it('keeps a key set explicitly by the caller', () => {
    const keys = sequentialKeys();
    const headers = headerBag({ [IDEMPOTENCY_KEY_HEADER]: 'callers-own-key' });
    attachIdempotencyKey(keys, { ...create, headers });
    expect(headers.get(IDEMPOTENCY_KEY_HEADER)).toBe('callers-own-key');
  });

  it('leaves requests that are not protected without the header', () => {
    const keys = sequentialKeys();
    const headers = headerBag();
    attachIdempotencyKey(keys, { method: 'get', url: '/api/customers', headers });
    expect(headers.get(IDEMPOTENCY_KEY_HEADER)).toBeUndefined();
    // Відповідь без заголовка в конфігу нічого не ламає
    settleIdempotencyKey(keys, undefined, { status: 200 });
    settleIdempotencyKey(keys, { headers }, { status: 200 });
  });
});
