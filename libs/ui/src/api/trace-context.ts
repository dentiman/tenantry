/**
 * W3C Trace Context для запитів фронтенду: `traceparent` = `00-<trace-id>-<parent-id>-01`.
 * Бекенд бере звідси trace-id як id запиту (`libs/shared/src/logging/trace-context.ts`), тож
 * ланцюг «дія в браузері → HTTP-запит → джоби воркера» шукається в логах за одним значенням,
 * відомим фронтенду ще до відповіді (і тоді, коли відповіді не було зовсім).
 */
export const TRACEPARENT_HEADER = 'traceparent';

const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

export function traceIdOf(traceparent: unknown): string | undefined {
  return typeof traceparent === 'string' ? TRACEPARENT.exec(traceparent)?.[1] : undefined;
}

interface HeaderBag {
  get(name: string): unknown;
  set(name: string, value: string): unknown;
}

/**
 * Для request-інтерсептора axios. Наявний заголовок не чіпає: повтор запиту після refresh
 * токена — та сама операція користувача, отже той самий trace.
 */
export function ensureTraceparent(headers: HeaderBag): void {
  if (traceIdOf(headers.get(TRACEPARENT_HEADER)) === undefined) {
    headers.set(TRACEPARENT_HEADER, newTraceparent());
  }
}
