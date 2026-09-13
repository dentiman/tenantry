import { REALTIME_DEFAULT_KEY_PREFIX } from '@saas-skeleton/contracts';

/**
 * Адреса і префікс Valkey — спільні для ВСІХ споживачів процесу (realtime-адаптер,
 * presence, throttler). Одне місце дефолтів: розійшовшись, realtime і throttler
 * дивилися б у різні інстанси без жодної помилки.
 *
 * Дефолти = docker-compose dev, тому `pnpm docker:up` + `pnpm api:dev` працюють
 * без рядка в .env.
 */
export const DEFAULT_REDIS_URL = 'redis://:saas-realtime@localhost:6379';

// Спільна з воркером константа: розійшовшись, процеси писали б у різні стріми
export const DEFAULT_REDIS_KEY_PREFIX = REALTIME_DEFAULT_KEY_PREFIX;

export function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export function resolveRedisKeyPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return env.REALTIME_KEY_PREFIX ?? DEFAULT_REDIS_KEY_PREFIX;
}
