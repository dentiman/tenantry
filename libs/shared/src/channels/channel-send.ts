import type { ChannelErrorClass, ContactAddressKind } from '@saas-skeleton/contracts';

/** Що адаптеру потрібно, щоб надіслати одне текстове повідомлення (CHAT-2b, design.md D4) */
export interface OutboundContext {
  /** Ідентифікатор НАШОГО номера в провайдера (WhatsApp: `phone_number_id`) */
  channelExternalId: string;
  to: { kind: ContactAddressKind; value: string };
  /** Наш id повідомлення; провайдеру йде як opaque-значення, за яким він повертає квитанцію */
  messageId: string;
  body: string;
  /** Схвалений шаблон замість тексту (`body` лишається підписом для логів/прев'ю) */
  template?: { name: string; language: string };
  /** З 1; береться з рядка — fake за ним вміє «впасти один раз» */
  attempt: number;
  /** Жорсткий таймаут відправки: адаптер зобовʼязаний його поважати */
  signal: AbortSignal;
}

/**
 * Єдиний тип помилки, яким `send` повідомляє про відмову провайдера. Адаптер ПЕРЕКЛАДАЄ код
 * провайдера в клас — ядро діє за класом (design.md D2), а таблиця «код Meta → клас» живе лише в
 * адаптері CHAT-3a.
 */
export class ChannelSendError extends Error {
  constructor(
    readonly errorClass: ChannelErrorClass,
    /** Код провайдера як текст — зберігається в `failure` */
    readonly code: string,
    /** Людська назва причини; не секрет і не сирий текст провайдера з даними клієнта */
    readonly title: string,
    readonly retryAfterSeconds?: number,
    /** HTTP-статус відповіді провайдера, якщо була — для журналу викликів */
    readonly httpStatus?: number,
  ) {
    super(`${errorClass}: ${code} ${title}`);
    this.name = 'ChannelSendError';
  }
}

export interface ClassifiedSendFailure {
  errorClass: ChannelErrorClass;
  code: string;
  title: string;
  retryAfterSeconds?: number;
  httpStatus?: number;
}

/**
 * Усе, що `send` кинув НЕ як `ChannelSendError` (помилка в адаптері, нерозпізнана мережева
 * помилка, таймаут), вважається тимчасовим: краще повторити з межею, ніж загубити репліку.
 */
export function classifySendFailure(error: unknown): ClassifiedSendFailure {
  if (error instanceof ChannelSendError) {
    return {
      errorClass: error.errorClass,
      code: error.code,
      title: error.title,
      ...(error.retryAfterSeconds !== undefined && { retryAfterSeconds: error.retryAfterSeconds }),
      ...(error.httpStatus !== undefined && { httpStatus: error.httpStatus }),
    };
  }
  const aborted =
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
  return {
    errorClass: 'TRANSIENT',
    code: aborted ? 'timeout' : 'unclassified',
    title: aborted ? 'The provider did not answer in time' : 'Unclassified delivery error',
  };
}
