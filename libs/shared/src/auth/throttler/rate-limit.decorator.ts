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
  /** AUTH-3: 3/год на пару (email, ip) — запит скидання пароля; поріг — константа (план D-15) */
  passwordReset: 'password-reset',
  /** AUTH-3: 20/год на ip — стеля для запиту скидання пароля з одного IP */
  passwordResetIp: 'password-reset-ip',
  /** AUTH-3: 5/год на користувача — запит зміни email */
  emailChange: 'email-change',
  /**
   * AUTH-3: 10/хв на ip — спільний для ОБОХ публічних confirm-роутів
   * (`password-reset/confirm`, `email-change/confirm`): один поріг на «клацання
   * по лінку з листа», значення в контракті однакове для обох
   */
  verificationConfirm: 'verification-confirm',
  /**
   * AI-0: 10/хв на користувача — питання до асистента. Не заміна квотам (вони
   * в AI-1), а захист черги: цикл не має права набити її тисячею job-ів навіть
   * на безкоштовному фейковому провайдері
   */
  aiAsk: 'ai-ask',
  /** CHAT-2a: вебхук провайдера, на пару (ключ каналу, ip) — рахує і відмови підпису */
  channelWebhook: 'channel-webhook',
  /** CHAT-3a: дії адміна, що ходять у Meta (підключення, оновлення токена, синхронізація) — на КОРИСТУВАЧА */
  messagingConnect: 'messaging-connect',
} as const;

export type RateLimitName = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];

export const RATE_LIMIT_KEY = 'rate-limits';

export const RateLimit = (...names: RateLimitName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, names);
