import { z } from 'zod';
import { REALTIME_DEFAULT_KEY_PREFIX } from '@saas-skeleton/contracts';

/**
 * Конфіг realtime-шару. Дефолти = docker-compose dev (той самий підхід, що в
 * StorageService → SeaweedFS): `pnpm docker:up` + `pnpm api:dev` мають працювати
 * без жодного рядка в .env.
 *
 * Валідація виконується НА СТАРТІ (RT-0): помилка в env має валити процес одразу,
 * а не проявлятись за пів години розʼїханою presence.
 */

const DEFAULT_REDIS_URL = 'redis://:saas-realtime@localhost:6379';
// Спільна з воркером константа: розійшовшись, процеси писали б у різні стріми
const DEFAULT_KEY_PREFIX = REALTIME_DEFAULT_KEY_PREFIX;
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173';
const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_RECOVERY_MS = 120_000;
const DEFAULT_SWEEP_MS = 5_000;
// RT-3: як часто ЖИВА сесія оновлює довговічний last_seen_at, і як часто буфер
// позначок зливається в БД. Обидва свідомо великі: точність тут потрібна не
// секундна (підпис «last seen 5 minutes ago»), а запис у Postgres — дорогий
// відносно heartbeat-а у Valkey
const DEFAULT_LAST_SEEN_MARK_MS = 300_000;
const DEFAULT_LAST_SEEN_FLUSH_MS = 15_000;

const RealtimeConfigSchema = z
  .object({
    redisUrl: z.string().min(1),
    /** Префікс УСІХ ключів: дозволяє ділити один Valkey між інсталяціями */
    keyPrefix: z.string().min(1),
    /**
     * Allowlist origin-ів. Перевіряється через Socket.IO `allowRequest`, а не лише
     * CORS: browser CORS захищає HTTP-транспорт, але НЕ WebSocket.
     */
    allowedOrigins: z.array(z.string().min(1)).min(1),
    leaseTtlMs: z.number().int().min(5_000),
    heartbeatMs: z.number().int().min(1_000),
    /** Вікно Socket.IO connection state recovery; 0 = вимкнути */
    recoveryMs: z.number().int().min(0),
    sweepMs: z.number().int().min(1_000),
    /** Періодичне оновлення last_seen_at для сесій, які просто тривають */
    lastSeenMarkMs: z.number().int().min(1_000),
    /** Інтервал зливу буфера позначок у БД */
    lastSeenFlushMs: z.number().int().min(100),
  })
  .refine((c) => c.heartbeatMs * 2 <= c.leaseTtlMs, {
    message:
      'REALTIME_HEARTBEAT_MS must be at most half of REALTIME_LEASE_TTL_MS — ' +
      'a lease has to survive one missed heartbeat, otherwise a healthy node flaps users offline',
  })
  .refine((c) => c.lastSeenFlushMs <= c.lastSeenMarkMs, {
    message:
      'REALTIME_LAST_SEEN_FLUSH_MS must not exceed REALTIME_LAST_SEEN_MARK_MS — ' +
      'flushing less often than marks appear only delays the same writes',
  });

export type RealtimeConfig = z.infer<typeof RealtimeConfigSchema>;

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

export function loadRealtimeConfig(env: NodeJS.ProcessEnv = process.env): RealtimeConfig {
  const parsed = RealtimeConfigSchema.safeParse({
    redisUrl: env.REDIS_URL ?? DEFAULT_REDIS_URL,
    keyPrefix: env.REALTIME_KEY_PREFIX ?? DEFAULT_KEY_PREFIX,
    allowedOrigins: toOrigins(env.REALTIME_ALLOWED_ORIGINS),
    leaseTtlMs: toInt(env.REALTIME_LEASE_TTL_MS, DEFAULT_LEASE_TTL_MS),
    heartbeatMs: toInt(env.REALTIME_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS),
    recoveryMs: toInt(env.REALTIME_RECOVERY_MS, DEFAULT_RECOVERY_MS),
    sweepMs: toInt(env.REALTIME_SWEEP_MS, DEFAULT_SWEEP_MS),
    lastSeenMarkMs: toInt(env.REALTIME_LAST_SEEN_MARK_MS, DEFAULT_LAST_SEEN_MARK_MS),
    lastSeenFlushMs: toInt(env.REALTIME_LAST_SEEN_FLUSH_MS, DEFAULT_LAST_SEEN_FLUSH_MS),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid realtime configuration — ${issues}`);
  }

  return parsed.data;
}
