import { createHash } from 'node:crypto';

/** Ім'я заголовка в нижньому регістрі — так його віддає Node у `req.headers` */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Позначка відповіді, відданої зі сховища, а не обробником (та сама назва, що в Stripe) */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** 1–255 видимих ASCII-символів без пробілів: UUID, ULID, довільний токен клієнта */
const KEY_FORMAT = /^[\x21-\x7E]{1,255}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_FORMAT.test(value);
}

/**
 * JSON з ключами обʼєктів у відсортованому порядку (рекурсивно). Порядок елементів масиву —
 * частина змісту й зберігається. Потрібен, щоб відбиток запиту не залежав від того, в якому
 * порядку клієнт серіалізував поля: сервер бачить уже розібране тіло, а не байти.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

export interface FingerprintInput {
  method: string;
  /** Шлях разом із query — `req.originalUrl` */
  url: string;
  /** Розібране тіло запиту (до валідації) */
  body: unknown;
}

/**
 * Відбиток запиту: той самий ключ з іншим методом, шляхом чи тілом — це ІНШИЙ запит, і він
 * отримує 422, а не чужу відповідь (IETF httpapi-idempotency-key-header §2.2).
 */
export function requestFingerprint(input: FingerprintInput): string {
  return createHash('sha256')
    .update(input.method.toUpperCase())
    .update('\n')
    .update(input.url)
    .update('\n')
    .update(canonicalJson(input.body))
    .digest('hex');
}
