import type { Request, Response } from 'express';
import { resolveCookieSecure } from '../config/env.schema';

/**
 * Дзеркало `apps/api/src/auth/refresh-cookie.ts` (AUTH-2, план §3.4). Окреме ім'я
 * cookie — у dev обидва фронти живуть на `localhost`, порт cookie не розділяє.
 */
export const PLATFORM_REFRESH_COOKIE_NAME = 'saas_platform_refresh';
export const PLATFORM_REFRESH_COOKIE_PATH = '/api/auth';

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
    path: PLATFORM_REFRESH_COOKIE_PATH,
    secure: resolveCookieSecure(),
    maxAge,
  };
}

export function setPlatformRefreshCookie(res: Response, token: string, idleExpiresAt: Date): void {
  const maxAge = Math.max(idleExpiresAt.getTime() - Date.now(), 0);
  res.cookie(PLATFORM_REFRESH_COOKIE_NAME, token, cookieOptions(maxAge));
}

export function clearPlatformRefreshCookie(res: Response): void {
  res.cookie(PLATFORM_REFRESH_COOKIE_NAME, '', cookieOptions(0));
}

export function readPlatformRefreshCookie(req: Request): string | undefined {
  // @types/cookie-parser типізує `req.cookies` як `any` — звужуємо явно
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[PLATFORM_REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
