import type { Request, Response } from 'express';
import { resolveCookieSecure } from '../config/env.schema';

/**
 * Одне місце на ім'я refresh-cookie і її опції (AUTH-2, план §3.1). `Path=/api/auth`
 * звужує cookie до auth-роутів (`setGlobalPrefix('api')` + контролер `auth`) — вона
 * не їде на кожен запит до API, лише на логін/refresh/logout/зміну пароля.
 *
 * `SameSite=Lax` закриває CSRF на cross-site POST для сучасних браузерів; `Strict`
 * нічого не додає (переходів за посиланням на ці роути немає), але ламає повернення
 * з зовнішніх лінків. Origin-check (`origin.guard.ts`) — пояс і підтяжки для старих
 * браузерів без `SameSite`.
 */
export const REFRESH_COOKIE_NAME = 'saas_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';

function cookieOptions(maxAge: number): {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    secure: resolveCookieSecure(),
    maxAge,
  };
}

/** Ставить cookie з новим refresh-токеном; `maxAge` рахується з `idleExpiresAt` сесії */
export function setRefreshCookie(res: Response, token: string, idleExpiresAt: Date): void {
  const maxAge = Math.max(idleExpiresAt.getTime() - Date.now(), 0);
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions(maxAge));
}

/** Очищення на logout — той самий `Path`, `Max-Age=0` */
export function clearRefreshCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE_NAME, '', cookieOptions(0));
}

/** Джерело токена — спочатку cookie (AUTH-2); `read` не знає про перехідне тіло */
export function readRefreshCookie(req: Request): string | undefined {
  // @types/cookie-parser типізує `req.cookies` як `any` — звужуємо явно
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
