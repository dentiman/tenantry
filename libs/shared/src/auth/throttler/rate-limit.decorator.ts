import { SetMetadata } from '@nestjs/common';

/**
 * Іменовані ліміти (AUTH-0, переїзд у AUTH-2 — другий споживач apps/platform-api,
 * research R-15). `default` діє на всі HTTP-роути без декоратора; решта — лише
 * там, де їх перелічено (`@nestjs/throttler` v6 застосовує кожен оголошений
 * throttler до кожного роуту, тому opt-in робить `skipIf` за цими метаданими).
 */
export const RATE_LIMITS = {
  /** Загальна стеля — на користувача/оператора, анонімні — на ip */
  default: 'default',
  /** 5/хв на пару (email, ip) — ключ бере email із тіла логіну */
  login: 'login',
  /** 20/хв на ip для логіну — стеля для розподіленої по email атаки з одного IP */
  loginIp: 'login-ip',
  /** 30/хв на ip — ротація легальна, але не сотнями */
  refresh: 'refresh',
  /** 10/год на користувача — зміна пароля, «вийти звідусіль» (лише tenant-api) */
  accountSensitive: 'account-sensitive',
} as const;

export type RateLimitName = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];

export const RATE_LIMIT_KEY = 'rate-limits';

export const RateLimit = (...names: RateLimitName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, names);
