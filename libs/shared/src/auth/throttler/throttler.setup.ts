import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RATE_LIMIT_KEY, RATE_LIMITS, type RateLimitName } from './rate-limit.decorator';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { loadThrottleConfig } from './throttle.config';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// RFC 5321: адреса довша за 254 символи не існує — довше в ключ Redis не кладемо
const MAX_EMAIL_KEY_LENGTH = 254;

/**
 * AUTH-3 (events-and-config.md §5, plan D-15): пороги скидання пароля й зміни email —
 * значення ДИЗАЙНУ, не зі спеки, e2e їх не піднімає (research R-17 стосується лише
 * логіну — той самий IP б'є в НЕ пов'язані роути в решті сьютів). Константи, а не env.
 */
const PASSWORD_RESET_LIMIT_PER_HOUR = 3;
const PASSWORD_RESET_IP_LIMIT_PER_HOUR = 20;
const EMAIL_CHANGE_LIMIT_PER_HOUR = 5;
const VERIFICATION_CONFIRM_LIMIT_PER_MINUTE = 10;

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

export const ipOf = (req: Record<string, unknown>): string =>
  typeof req.ip === 'string' ? req.ip : 'unknown';

/**
 * Ключ логіну — (email, ip). Guard виконується ДО Zod-пайпа, тож тіло недовірене:
 * нормалізуємо так само, як LoginSchema (`trim().toLowerCase()`), і обрізаємо, щоб
 * сміттєві рядки не роздували простір ключів. Не рядок → лише ip (research R-02).
 */
export function emailAndIpTracker(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = body?.email;
  if (typeof email !== 'string') {
    return ipOf(req);
  }
  const normalized = email.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_LENGTH);
  return `${normalized}|${ipOf(req)}`;
}

/**
 * Вебхук провайдера: ключ каналу з адреси + ip. Ключ — у шляху, тому береться з `req.params`
 * (guard виконується після маршрутизації); без нього — лише ip. Довжину обрізаємо: недовірений
 * рядок не роздуває простір ключів Redis.
 */
export function webhookKeyAndIpTracker(req: Record<string, unknown>): string {
  const params = req.params as { webhookKey?: unknown } | undefined;
  const key = typeof params?.webhookKey === 'string' ? params.webhookKey.slice(0, 128) : '';
  return key ? `${key}|${ipOf(req)}` : ipOf(req);
}

export interface CreateAppThrottlerModuleOptions {
  /** DI-токен клієнта Redis без offline-черги (свій у кожного процесу) */
  redisClientToken: string | symbol;
  /**
   * Префікс ключів у Valkey — свій на процес, щоб два процеси не ділили лічильники.
   * Функція, а НЕ рядок: `createAppThrottlerModule(...)` викликається на верхньому
   * рівні модуля (раз на весь процес — Node кешує імпорт), тож рядок, обчислений
   * одразу, «заморозив» би `REALTIME_KEY_PREFIX` зі старту процесу. e2e-сьюти
   * (`rate-limit.e2e-spec.ts`) перевизначають цю змінну ПЕРЕД компіляцією своєї
   * копії `AppModule` — виклик читає `process.env` заново щоразу, коли Nest
   * резолвить `ThrottlerModule.forRootAsync` для нового інстансу застосунку
   */
  keyPrefix: () => string;
  /**
   * Ключ загальної стелі `default` (юзер/оператор із контексту запиту після guard-а
   * автентифікації; анонімні запити рахуються на ip). tenant-api передає трекер за
   * `req.user.sub`, platform-api — за `req.operator.sub`
   */
  principalTracker: (req: Record<string, unknown>) => string;
}

/**
 * Обмеження частоти (AUTH-0, переїзд у `libs/shared` заходом AUTH-2 — R-15, другий
 * споживач apps/platform-api). `default` — помірна стеля від абузу на всі HTTP-роути;
 * решта — бізнес-ліміти чутливих роутів, увімкнені через `@RateLimit`. Лічильники —
 * у Valkey (спільні для реплік), відмова сховища → fail-open.
 */
export function createAppThrottlerModule(options: CreateAppThrottlerModuleOptions): DynamicModule {
  return ThrottlerModule.forRootAsync({
    inject: [options.redisClientToken],
    useFactory: (redis: Redis) => {
      const config = loadThrottleConfig();
      const throttlers: ThrottlerOptions[] = [
        {
          // Стеля на ЛЮДИНУ, а не на адресу: за корпоративним NAT десятки співробітників
          // ділять один IP — ліміт на IP віддавав би 429 цілій організації. На IP
          // рахуються лише анонімні запити (для захищених роутів guard відповідає 401 раніше)
          name: RATE_LIMITS.default,
          ttl: MINUTE_MS,
          limit: config.defaultPerMinute,
          skipIf: (context) => !isHttp(context),
          getTracker: options.principalTracker,
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
          getTracker: options.principalTracker,
        },
        {
          // Той самий трекер, що login: email із тіла запиту скидання пароля + ip
          name: RATE_LIMITS.passwordReset,
          ttl: HOUR_MS,
          limit: PASSWORD_RESET_LIMIT_PER_HOUR,
          skipIf: optIn(RATE_LIMITS.passwordReset),
          getTracker: emailAndIpTracker,
        },
        {
          name: RATE_LIMITS.passwordResetIp,
          ttl: HOUR_MS,
          limit: PASSWORD_RESET_IP_LIMIT_PER_HOUR,
          skipIf: optIn(RATE_LIMITS.passwordResetIp),
        },
        {
          name: RATE_LIMITS.emailChange,
          ttl: HOUR_MS,
          limit: EMAIL_CHANGE_LIMIT_PER_HOUR,
          skipIf: optIn(RATE_LIMITS.emailChange),
          getTracker: options.principalTracker,
        },
        {
          // AI-0: на КОРИСТУВАЧА, не на ip — асистент за логіном, а за корпоративним
          // NAT ліміт на адресу вдарив би по цілій організації (та сама логіка,
          // що в `default` і `accountSensitive`)
          name: RATE_LIMITS.aiAsk,
          ttl: MINUTE_MS,
          limit: config.aiAskPerMinute,
          skipIf: optIn(RATE_LIMITS.aiAsk),
          getTracker: options.principalTracker,
        },
        {
          name: RATE_LIMITS.channelWebhook,
          ttl: MINUTE_MS,
          limit: config.channelWebhookPerMinute,
          skipIf: optIn(RATE_LIMITS.channelWebhook),
          getTracker: webhookKeyAndIpTracker,
        },
        {
          // CHAT-3a: на КОРИСТУВАЧА (адмін), не на ip — звичайна логіка адмінських дій
          name: RATE_LIMITS.messagingConnect,
          ttl: MINUTE_MS,
          limit: config.messagingConnectPerMinute,
          skipIf: optIn(RATE_LIMITS.messagingConnect),
          getTracker: options.principalTracker,
        },
        {
          name: RATE_LIMITS.verificationConfirm,
          ttl: MINUTE_MS,
          limit: VERIFICATION_CONFIRM_LIMIT_PER_MINUTE,
          skipIf: optIn(RATE_LIMITS.verificationConfirm),
        },
      ];
      return {
        throttlers,
        getTracker: ipOf,
        // Заголовки ставить AppThrottlerGuard — лише стандартний Retry-After на 429
        setHeaders: false,
        storage: new RedisThrottlerStorage(redis, options.keyPrefix(), config.storageTimeoutMs),
      };
    },
  });
}
