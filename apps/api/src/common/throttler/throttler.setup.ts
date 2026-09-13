import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS_THROTTLER_CLIENT } from '../../redis/redis.constants';
import { RATE_LIMIT_KEY, RATE_LIMITS, type RateLimitName } from './rate-limit.decorator';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { loadThrottleConfig } from './throttle.config';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// RFC 5321: адреса довша за 254 символи не існує — довше в ключ Redis не кладемо
const MAX_EMAIL_KEY_LENGTH = 254;

// Reflector без залежностей: лише читає метадані декораторів
const reflector = new Reflector();

/** Throttler-и працюють тільки для HTTP: гейтвей Socket.IO має свій контекст без req/res */
const isHttp = (context: ExecutionContext): boolean => context.getType() === 'http';

function enabledOnRoute(context: ExecutionContext, name: RateLimitName): boolean {
  const names = reflector.getAllAndOverride<RateLimitName[] | undefined>(RATE_LIMIT_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  return names?.includes(name) ?? false;
}

/** Opt-in ліміт: діє лише на роутах, що перелічили його в @RateLimit */
const optIn =
  (name: RateLimitName) =>
  (context: ExecutionContext): boolean =>
    !isHttp(context) || !enabledOnRoute(context, name);

const ipOf = (req: Record<string, unknown>): string =>
  typeof req.ip === 'string' ? req.ip : 'unknown';

/**
 * Ключ логіну — (email, ip). Guard виконується ДО Zod-пайпа, тож тіло недовірене:
 * нормалізуємо так само, як LoginSchema (`trim().toLowerCase()`), і обрізаємо, щоб
 * сміттєві рядки не роздували простір ключів. Не рядок → лише ip (research R-02).
 */
function emailAndIpTracker(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = body?.email;
  if (typeof email !== 'string') {
    return ipOf(req);
  }
  const normalized = email.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_LENGTH);
  return `${normalized}|${ipOf(req)}`;
}

/**
 * Ліміт на користувача. Виконується після JwtAuthGuard (порядок APP_GUARD в
 * AuthModule), тож `req.user` уже є; без нього — ip.
 */
function userTracker(req: Record<string, unknown>): string {
  const user = req.user as { sub?: unknown } | undefined;
  return typeof user?.sub === 'string' ? `user:${user.sub}` : ipOf(req);
}

/**
 * Обмеження частоти (AUTH-0). `default` — помірна стеля від абузу на всі HTTP-роути
 * (на користувача, для анонімних — на ip);
 * решта — бізнес-ліміти чутливих роутів, увімкнені через @RateLimit.
 * Лічильники — у Valkey (спільні для реплік), відмова сховища → fail-open.
 */
export const AppThrottlerModule = ThrottlerModule.forRootAsync({
  inject: [REDIS_THROTTLER_CLIENT],
  useFactory: (redis: Redis) => {
    const config = loadThrottleConfig();
    const throttlers: ThrottlerOptions[] = [
      {
        // Стеля на ЛЮДИНУ, а не на адресу: за корпоративним NAT десятки співробітників
        // ділять один IP, і SPA кожного робить багато запитів (гріди, presence, дзвінок) —
        // ліміт на IP віддавав би 429 цілій організації. На IP рахуються лише анонімні
        // запити (публічні роути; для захищених JwtAuthGuard відповідає 401 раніше)
        name: 'default',
        ttl: MINUTE_MS,
        limit: config.defaultPerMinute,
        skipIf: (context) => !isHttp(context),
        getTracker: userTracker,
      },
      {
        name: RATE_LIMITS.login,
        ttl: MINUTE_MS,
        limit: config.loginPerMinute,
        skipIf: optIn(RATE_LIMITS.login),
        getTracker: emailAndIpTracker,
      },
      {
        name: RATE_LIMITS.loginIp,
        ttl: MINUTE_MS,
        limit: config.loginIpPerMinute,
        skipIf: optIn(RATE_LIMITS.loginIp),
      },
      {
        name: RATE_LIMITS.refresh,
        ttl: MINUTE_MS,
        limit: config.refreshPerMinute,
        skipIf: optIn(RATE_LIMITS.refresh),
      },
      {
        name: RATE_LIMITS.accountSensitive,
        ttl: HOUR_MS,
        limit: config.accountSensitivePerHour,
        skipIf: optIn(RATE_LIMITS.accountSensitive),
        getTracker: userTracker,
      },
    ];
    return {
      throttlers,
      getTracker: ipOf,
      // Заголовки ставить AppThrottlerGuard — лише стандартний Retry-After на 429
      setHeaders: false,
      storage: new RedisThrottlerStorage(redis, config.storageTimeoutMs),
    };
  },
});
