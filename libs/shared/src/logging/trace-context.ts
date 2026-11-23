import { randomBytes } from 'node:crypto';

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/): `traceparent` =
 * `00-<trace-id: 32 hex>-<parent-id: 16 hex>-<flags: 2 hex>`. Власного трейсингу тут немає —
 * береться лише trace-id як наскрізний ідентифікатор операції, щоб підключений пізніше
 * OpenTelemetry продовжив ТІ САМІ id, а не завів другі поруч.
 */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const TRACE_ID = /^[0-9a-f]{32}$/;

export const TRACEPARENT_HEADER = 'traceparent';

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** trace-id з заголовка; undefined — заголовка немає або він не за специфікацією */
export function traceIdFromTraceparent(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    return undefined;
  }
  const traceId = TRACEPARENT.exec(value.trim())?.[1];
  return traceId !== undefined && traceId !== ZERO_TRACE_ID ? traceId : undefined;
}

/**
 * Корінь ланцюга поза HTTP (cron-тік, публікація зі скрипта): uuid без дефісів — це вже
 * 32 hex, тож id лишається детермінованим (повтор тієї самої джоби = той самий trace).
 */
export function traceIdFromUuid(uuid: string): string {
  const compact = uuid.replaceAll('-', '').toLowerCase();
  return TRACE_ID.test(compact) && compact !== ZERO_TRACE_ID ? compact : newTraceId();
}
