import { REALTIME_DEFAULT_KEY_PREFIX } from '@saas-skeleton/contracts';

/**
 * Адреса і префікс Valkey (AUTH-2, дзеркало apps/api/src/redis/redis.config.ts).
 * Той самий дефолт, що tenant-api: у dev обидва процеси читають один
 * `docker:up`-стек. Префікс СПІЛЬНИЙ з tenant-api (`REALTIME_KEY_PREFIX`) навмисно:
 * ключі throttler-а нижче ще отримують im'я процесу (`platform:throttle:…`),
 * тож перетину з tenant-лічильниками не буде навіть на одному Valkey.
 */
export const DEFAULT_REDIS_URL = 'redis://:saas-realtime@localhost:6379';
export const DEFAULT_REDIS_KEY_PREFIX = REALTIME_DEFAULT_KEY_PREFIX;

export function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export function resolveRedisKeyPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return env.REALTIME_KEY_PREFIX ?? DEFAULT_REDIS_KEY_PREFIX;
}
