import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  isValidIdempotencyKey,
  requestFingerprint,
} from './idempotency-fingerprint';

describe('isValidIdempotencyKey', () => {
  it('accepts 1 to 255 visible ASCII characters', () => {
    expect(isValidIdempotencyKey('a')).toBe(true);
    expect(isValidIdempotencyKey('7f9c2b1e-6c1d-4a59-9a39-3a0e2c0f8f11')).toBe(true);
    expect(isValidIdempotencyKey('x'.repeat(255))).toBe(true);
  });

  it('rejects empty, oversized, spaced, non-ASCII and non-string values', () => {
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(256))).toBe(false);
    expect(isValidIdempotencyKey('two words')).toBe(false);
    expect(isValidIdempotencyKey('ключ')).toBe(false);
    expect(isValidIdempotencyKey('line\nbreak')).toBe(false);
    expect(isValidIdempotencyKey(['a', 'b'])).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });
});

describe('canonicalJson', () => {
  it('does not depend on object key order, at any depth', () => {
    const first = { name: 'Acme', address: { city: 'Kyiv', zip: '01001' }, tags: ['a', 'b'] };
    const second = { tags: ['a', 'b'], address: { zip: '01001', city: 'Kyiv' }, name: 'Acme' };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it('keeps array order, because it is part of the content', () => {
    expect(canonicalJson({ tags: ['a', 'b'] })).not.toBe(canonicalJson({ tags: ['b', 'a'] }));
  });

  it('distinguishes null, a missing field and an absent body', () => {
    expect(canonicalJson({ owner: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson(undefined)).toBe('');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('requestFingerprint', () => {
  const base = { method: 'POST', url: '/api/customers', body: { name: 'Acme' } };

  it('is stable for the same request', () => {
    expect(requestFingerprint(base)).toBe(requestFingerprint({ ...base, method: 'post' }));
    expect(requestFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the method, the path, the query and the body', () => {
    const original = requestFingerprint(base);
    expect(requestFingerprint({ ...base, method: 'PUT' })).not.toBe(original);
    expect(requestFingerprint({ ...base, url: '/api/calendar/events' })).not.toBe(original);
    expect(requestFingerprint({ ...base, url: '/api/customers?dryRun=1' })).not.toBe(original);
    expect(requestFingerprint({ ...base, body: { name: 'Acme Ltd' } })).not.toBe(original);
  });
});
