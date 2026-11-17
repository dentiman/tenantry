/**
 * Клієнтська половина `Idempotency-Key` (docs/idempotency.md). Ключ виводиться із САМОГО
 * запиту, в одному місці — HTTP-клієнті, тож форми про нього не знають:
 *
 * - той самий `POST` з тим самим тілом, поки попередня спроба ще летить або закінчилась без
 *   певної відповіді (мережа, тайм-аут, 5xx), іде з ТИМ САМИМ ключем — подвійний клік і
 *   повторний сабміт після втраченої відповіді сервер зведе до одного ефекту;
 * - щойно спроба отримала певну відповідь (2xx або відмова 4xx), ключ забувається: наступний
 *   такий самий запит — це вже новий намір (другий однаковий запис, виправлена форма).
 *
 * Сервер зважає на заголовок лише на ендпоінтах з `@Idempotent()`, решта його ігнорує.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/**
 * Скільки ключ спроби без певної відповіді лишається придатним до повтору. Достатньо, щоб
 * людина помітила помилку й натиснула ще раз; довше — і «той самий запит» уже радше новий намір.
 */
const ENTRY_TTL_MS = 15 * 60 * 1000;

/** Код відповіді, що означає «ефект застосовано, результат ще недоступний» — це не кінець спроби */
const IN_PROGRESS_CODE = 'IDEMPOTENCY_IN_PROGRESS';

interface Entry {
  key: string;
  createdAt: number;
}

export interface IdempotencyRequest {
  method?: string | undefined;
  url?: string | undefined;
  params?: unknown;
  data?: unknown;
}

export interface IdempotencyOutcome {
  /** HTTP-статус; null — відповіді не було (мережа, тайм-аут, скасування) */
  status: number | null;
  /** `ApiError.code`, якщо відповідь — envelope помилки */
  code?: string | null | undefined;
}

export interface IdempotencyKeys {
  /** Ключ для запиту (наявний або новий); undefined — запит не підлягає захисту */
  keyFor(request: IdempotencyRequest): string | undefined;
  /** Спроба з цим ключем завершилась; певна відповідь прибирає ключ */
  settle(key: string, outcome: IdempotencyOutcome): void;
}

interface Options {
  now?: () => number;
  newKey?: () => string;
  ttlMs?: number;
}

/** `crypto.randomUUID` недоступний поза secure context (стенд по http на IP) — як у trace-context */
function randomKey(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** JSON-тіло: обʼєкт/масив до серіалізації або рядок після неї (повтор запиту після refresh токена) */
function serializedBody(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data;
  }
  if (Array.isArray(data)) {
    return JSON.stringify(data);
  }
  if (typeof data === 'object' && data !== null) {
    const prototype: unknown = Object.getPrototypeOf(data);
    // FormData, Blob, ArrayBuffer, URLSearchParams — не JSON; такі запити не чіпаємо
    return prototype === Object.prototype || prototype === null ? JSON.stringify(data) : undefined;
  }
  return undefined;
}

function fingerprintOf(request: IdempotencyRequest): string | undefined {
  if (request.method?.toUpperCase() !== 'POST' || !request.url) {
    return undefined;
  }
  const body = serializedBody(request.data);
  if (body === undefined) {
    return undefined;
  }
  const params = request.params === undefined ? '' : JSON.stringify(request.params);
  return `POST ${request.url}\n${params}\n${body}`;
}

/**
 * Певна відповідь — та, після якої повтор з тим самим ключем уже не «та сама спроба»:
 * успіх або відмова, яку сервер видав, нічого не застосувавши. Невизначені: немає відповіді,
 * 5xx, 401 (запит буде повторено після refresh), 408/429 і «результат ще недоступний».
 */
export function isDefiniteOutcome(outcome: IdempotencyOutcome): boolean {
  const { status, code } = outcome;
  if (status === null || status >= 500) {
    return false;
  }
  if (status === 401 || status === 408 || status === 429) {
    return false;
  }
  return code !== IN_PROGRESS_CODE;
}

export function createIdempotencyKeys(options: Options = {}): IdempotencyKeys {
  const now = options.now ?? Date.now;
  const newKey = options.newKey ?? randomKey;
  const ttlMs = options.ttlMs ?? ENTRY_TTL_MS;
  const entries = new Map<string, Entry>();

  const dropExpired = (): void => {
    const threshold = now() - ttlMs;
    for (const [fingerprint, entry] of entries) {
      if (entry.createdAt <= threshold) {
        entries.delete(fingerprint);
      }
    }
  };

  return {
    keyFor(request) {
      const fingerprint = fingerprintOf(request);
      if (fingerprint === undefined) {
        return undefined;
      }
      dropExpired();
      const existing = entries.get(fingerprint);
      if (existing) {
        return existing.key;
      }
      const entry: Entry = { key: newKey(), createdAt: now() };
      entries.set(fingerprint, entry);
      return entry.key;
    },
    settle(key, outcome) {
      if (!isDefiniteOutcome(outcome)) {
        return;
      }
      for (const [fingerprint, entry] of entries) {
        if (entry.key === key) {
          entries.delete(fingerprint);
        }
      }
    },
  };
}

interface HeaderBag {
  get(name: string): unknown;
  set(name: string, value: string): unknown;
}

function explicitKey(headers: HeaderBag): string | undefined {
  const value = headers.get(IDEMPOTENCY_KEY_HEADER);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Для request-інтерсептора axios. Наявний заголовок не чіпає: його поставив викликач (власний
 * ключ на намір) або це повтор того самого запиту після refresh токена.
 */
export function attachIdempotencyKey(
  keys: IdempotencyKeys,
  config: IdempotencyRequest & { headers: HeaderBag },
): void {
  if (explicitKey(config.headers) !== undefined) {
    return;
  }
  const key = keys.keyFor(config);
  if (key !== undefined) {
    config.headers.set(IDEMPOTENCY_KEY_HEADER, key);
  }
}

/** Для response-інтерсептора axios — і на успіх, і на помилку */
export function settleIdempotencyKey(
  keys: IdempotencyKeys,
  config: { headers?: { get?: (name: string) => unknown } | undefined } | undefined,
  outcome: IdempotencyOutcome,
): void {
  const value = config?.headers?.get?.(IDEMPOTENCY_KEY_HEADER);
  if (typeof value === 'string' && value !== '') {
    keys.settle(value, outcome);
  }
}
