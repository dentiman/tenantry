import { describe, expect, it } from 'vitest';
import { ensureTraceparent, newTraceparent, traceIdOf } from './trace-context';

function headerBag(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => values.set(name, value),
  };
}

describe('traceparent', () => {
  it('generates a spec-shaped header with a unique trace id', () => {
    const first = newTraceparent();
    expect(first).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(traceIdOf(first)).not.toBe(traceIdOf(newTraceparent()));
  });

  it('keeps the header of a retried request and replaces a malformed one', () => {
    const existing = newTraceparent();
    const retried = headerBag({ traceparent: existing });
    ensureTraceparent(retried);
    expect(retried.get('traceparent')).toBe(existing);

    const malformed = headerBag({ traceparent: 'abc' });
    ensureTraceparent(malformed);
    expect(traceIdOf(malformed.get('traceparent'))).toBeDefined();
  });
});
