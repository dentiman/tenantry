import { describe, expect, it } from 'vitest';
import { META_ERROR_CODES, classifyMetaError, metaErrorRow } from './errors';
import { MetaApiError } from './graph-client';

function api(
  code: number | null,
  httpStatus: number | null = 400,
  kind: 'api' | 'network' | 'timeout' = 'api',
  retry?: number,
): MetaApiError {
  return new MetaApiError(kind, httpStatus, code, null, `meta says ${String(code)}`, null, retry);
}

/** Кожен рядок таблиці зафіксовано окремо: зміна класу коду — свідоме рішення, а не побічний ефект */
const EXPECTED: Record<number, string> = {
  131047: 'WINDOW_CLOSED',
  131026: 'PERMANENT',
  131030: 'PERMANENT',
  131008: 'PERMANENT',
  131009: 'PERMANENT',
  100: 'PERMANENT',
  135000: 'PERMANENT',
  132000: 'PERMANENT',
  132001: 'PERMANENT',
  132012: 'PERMANENT',
  132016: 'PERMANENT',
  132018: 'PERMANENT',
  131052: 'PERMANENT',
  131053: 'PERMANENT',
  131049: 'POLICY',
  131050: 'POLICY',
  130497: 'POLICY',
  130429: 'RATE_LIMITED',
  131056: 'RATE_LIMITED',
  80007: 'RATE_LIMITED',
  190: 'AUTH',
  0: 'AUTH',
  3: 'AUTH',
  10: 'AUTH',
  200: 'AUTH',
  131000: 'TRANSIENT',
  131016: 'TRANSIENT',
  131057: 'TRANSIENT',
  133004: 'TRANSIENT',
  131048: 'HUMAN',
  131031: 'HUMAN',
  130403: 'HUMAN',
  131042: 'HUMAN',
  131045: 'HUMAN',
};

describe('classifyMetaError', () => {
  it('таблиця містить рівно очікувані коди', () => {
    expect([...META_ERROR_CODES].sort((a, b) => a - b)).toEqual(
      Object.keys(EXPECTED)
        .map(Number)
        .sort((a, b) => a - b),
    );
  });

  it.each(Object.entries(EXPECTED))('код %s → %s', (code, errorClass) => {
    const result = classifyMetaError(api(Number(code)));
    expect(result.errorClass).toBe(errorClass);
    expect(result.code).toBe(code);
    expect(result.title.length).toBeGreaterThan(0);
  });

  it('131030 має заголовок про список дозволених отримувачів', () => {
    expect(classifyMetaError(api(131030)).title).toMatch(/allowed list/);
    expect(metaErrorRow(131030)?.errorClass).toBe('PERMANENT');
  });

  it('невідомий код: 4xx — PERMANENT, 5xx — TRANSIENT, 401 — AUTH', () => {
    expect(classifyMetaError(api(999999, 400)).errorClass).toBe('PERMANENT');
    expect(classifyMetaError(api(999999, 404)).errorClass).toBe('PERMANENT');
    expect(classifyMetaError(api(999999, 500)).errorClass).toBe('TRANSIENT');
    expect(classifyMetaError(api(null, 503)).errorClass).toBe('TRANSIENT');
    expect(classifyMetaError(api(null, 401)).errorClass).toBe('AUTH');
  });

  it('мережа й таймаут — TRANSIENT', () => {
    expect(classifyMetaError(api(null, null, 'network')).errorClass).toBe('TRANSIENT');
    expect(classifyMetaError(api(null, null, 'timeout')).errorClass).toBe('TRANSIENT');
  });

  it('Retry-After і HTTP-статус переносяться', () => {
    const result = classifyMetaError(api(130429, 429, 'api', 9));
    expect(result).toMatchObject({ retryAfterSeconds: 9, httpStatus: 429 });
  });

  it('заголовок обрізається до 200 символів', () => {
    const long = new MetaApiError('api', 400, 999999, null, 'x'.repeat(500), null);
    expect(classifyMetaError(long).title.length).toBeLessThanOrEqual(200);
  });
});
