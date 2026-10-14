import type { ChannelErrorClass } from '@saas-skeleton/contracts';
import { ChannelSendError } from '../channel-send';
import type { MetaApiError } from './graph-client';

interface Row {
  errorClass: ChannelErrorClass;
  /** Заголовок, коли хочемо свій замість тексту Meta (той лишається запасним) */
  title?: string;
}

/**
 * Таблиця «код Meta → клас доставки» (docs/whatsapp-channel.md §4.5; design.md D5). Лише дані: новий код —
 * один рядок, а юніт-тест фіксує КОЖЕН. Класи — ті самі сім, за якими діє доставка, нічого нового
 * їй не потрібно.
 */
const TABLE: Readonly<Record<number, Row>> = {
  // вікно вільного тексту закрите
  131047: { errorClass: 'WINDOW_CLOSED', title: 'The 24-hour reply window is closed' },
  // отримувач / параметри / шаблон / медіа — повторювати нема сенсу
  131026: {
    errorClass: 'PERMANENT',
    title: 'The recipient is not a WhatsApp user or cannot receive this message',
  },
  131030: {
    errorClass: 'PERMANENT',
    title: 'The recipient is not on the allowed list of this test account',
  },
  131008: { errorClass: 'PERMANENT' },
  131009: { errorClass: 'PERMANENT' },
  100: { errorClass: 'PERMANENT' },
  135000: { errorClass: 'PERMANENT' },
  132000: {
    errorClass: 'PERMANENT',
    title: 'The template needs parameters that were not supplied',
  },
  132001: { errorClass: 'PERMANENT', title: 'The template does not exist in this language' },
  132012: { errorClass: 'PERMANENT' },
  132016: { errorClass: 'PERMANENT' },
  132018: { errorClass: 'PERMANENT' },
  131052: { errorClass: 'PERMANENT' },
  131053: { errorClass: 'PERMANENT' },
  // політика
  131049: {
    errorClass: 'POLICY',
    title: 'Not delivered to maintain a healthy ecosystem engagement',
  },
  131050: { errorClass: 'POLICY', title: 'The customer stopped marketing messages' },
  130497: { errorClass: 'POLICY' },
  // ліміти частоти
  130429: { errorClass: 'RATE_LIMITED' },
  131056: { errorClass: 'RATE_LIMITED' },
  80007: { errorClass: 'RATE_LIMITED' },
  // автентифікація / права
  190: { errorClass: 'AUTH', title: 'The access token is invalid or has expired' },
  0: { errorClass: 'AUTH' },
  3: { errorClass: 'AUTH' },
  10: { errorClass: 'AUTH' },
  200: { errorClass: 'AUTH' },
  // тимчасове
  131000: { errorClass: 'TRANSIENT' },
  131016: { errorClass: 'TRANSIENT' },
  131057: { errorClass: 'TRANSIENT' },
  133004: { errorClass: 'TRANSIENT' },
  // потрібна людина
  131048: { errorClass: 'HUMAN' },
  131031: { errorClass: 'HUMAN', title: 'The WhatsApp account is locked' },
  130403: { errorClass: 'HUMAN' },
  131042: { errorClass: 'HUMAN', title: 'A payment method problem blocks sending' },
  131045: { errorClass: 'HUMAN' },
};

/** Коди таблиці (для тесту, що фіксує кожен рядок) */
export const META_ERROR_CODES: readonly number[] = Object.keys(TABLE).map(Number);

export function metaErrorRow(code: number): Row | undefined {
  return TABLE[code];
}

/**
 * Помилка Meta → `ChannelSendError` з одним із семи класів. Невідомий код: 4xx — `PERMANENT`, 5xx, мережа
 * і таймаут — `TRANSIENT` (краще повторити з межею, ніж загубити).
 */
export function classifyMetaError(error: MetaApiError): ChannelSendError {
  const row = error.code !== null ? TABLE[error.code] : undefined;
  const code = error.code !== null ? String(error.code) : error.kind;
  if (row) {
    return build(row.errorClass, code, row.title ?? error.title, error);
  }
  if (error.kind !== 'api') {
    return build('TRANSIENT', code, error.title, error);
  }
  const status = error.httpStatus ?? 0;
  return build(
    status >= 500 ? 'TRANSIENT' : status === 401 ? 'AUTH' : 'PERMANENT',
    code,
    error.title,
    error,
  );
}

function build(
  errorClass: ChannelErrorClass,
  code: string,
  title: string,
  error: MetaApiError,
): ChannelSendError {
  return new ChannelSendError(
    errorClass,
    code,
    title.slice(0, 200),
    error.retryAfterSeconds,
    error.httpStatus ?? undefined,
  );
}
