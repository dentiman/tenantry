import type {
  ClientEventErrorCode,
  RealtimeError,
  RealtimeErrorCode,
} from '@saas-skeleton/contracts';

/**
 * Помилка socket-шару. HTTP `AllExceptionsFilter` сюди не дістає (він ловить
 * exception-и HTTP-контексту), тому socket має власний нормалізований envelope —
 * із тим самим принципом, що в ApiError: закритий машинний `code` назовні,
 * англійський `message` для логів, жодних внутрішніх деталей.
 */
export class RealtimeAuthError extends Error {
  constructor(
    readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RealtimeAuthError';
  }
}

/**
 * Socket.IO віддає клієнту поле `data` з помилки middleware (подія `connect_error`).
 * Кладемо туди рівно `RealtimeError` — фронт розбирає його як ApiError.
 */
export function toHandshakeError(error: RealtimeAuthError): Error & { data: RealtimeError } {
  const wrapped = new Error(error.message) as Error & { data: RealtimeError };
  wrapped.data = { code: error.code, message: error.message };
  return wrapped;
}

/**
 * Відмова обробника зареєстрованої client → server події (`ClientEventRegistry`). Несе
 * закритий машинний `code`, який піде клієнтові в ack, і діагностичний англійський
 * `message`, який лишається в лозі: те саме розмежування, що в `ApiError`.
 *
 * Окремо від `RealtimeAuthError`: та — про handshake, ця — про подію вже авторизованого
 * зʼєднання.
 */
export class SocketEventError extends Error {
  constructor(
    readonly code: ClientEventErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'SocketEventError';
  }
}
