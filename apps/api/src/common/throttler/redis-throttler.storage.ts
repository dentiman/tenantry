import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { resolveRedisKeyPrefix } from '../../redis/redis.config';

// Пакет не експортує тип запису з кореня — виводимо з інтерфейсу сховища
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Запис, що пропускає запит: так виглядає fail-open для guard-а */
const PASS_THROUGH: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/**
 * Лічильники throttler-а у Valkey (AUTH-0, research R-01). Свідомо без пакета
 * `nestjs-throttler-storage-redis`: ~50 рядків, які ми й так мусимо розуміти.
 *
 * Fixed window: перший удар створює лічильник із TTL вікна (`SET … PX NX`), решта
 * інкрементують його; блокування триває до кінця того самого вікна. У swarm N реплік
 * бачать один лічильник — in-memory ліміт множився б на N.
 *
 * FAIL-OPEN (spec FR-004, clarify 2026-09-13): недоступний або повільний брокер →
 * запит пропускається з попередженням у лозі. Ліміт — додатковий контроль (пароль
 * лишається argon2), а вхід не має падати разом із брокером.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly keyPrefix = `${resolveRedisKeyPrefix()}:throttle`;

  constructor(
    // Клієнт REDIS_THROTTLER_CLIENT — без offline-черги (redis.constants.ts)
    private readonly redis: Redis,
    private readonly timeoutMs: number,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `${this.keyPrefix}:${throttlerName}:${key}`;
    try {
      const [totalHits, pttl] = await this.withTimeout(this.hit(redisKey, ttl));
      // Секунди — так рахує вбудоване сховище, з цього значення guard ставить Retry-After
      const timeToExpire = Math.max(Math.ceil(pttl / 1000), 0);
      const isBlocked = totalHits > limit;
      return {
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? timeToExpire : 0,
      };
    } catch (error) {
      this.logger.warn(
        {
          event: 'throttler_storage_unavailable',
          throttler: throttlerName,
          error: error instanceof Error ? error.message : String(error),
        },
        `Rate limit "${throttlerName}" skipped: throttler storage unavailable`,
      );
      return PASS_THROUGH;
    }
  }

  private async hit(redisKey: string, ttl: number): Promise<[number, number]> {
    const results = await this.redis
      .multi()
      .set(redisKey, '0', 'PX', ttl, 'NX')
      .incr(redisKey)
      .pttl(redisKey)
      .exec();
    if (!results) {
      throw new Error('Throttler transaction aborted');
    }
    const failed = results.find(([error]) => error !== null);
    if (failed?.[0]) {
      throw failed[0];
    }
    return [Number(results[1]?.[1]), Number(results[2]?.[1])];
  }

  /**
   * Клієнт без offline-черги падає одразу при розриві, але «живий, та повільний»
   * брокер лишився б непокритим — таймаут не дає логіну висіти на ньому.
   */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Throttler storage timeout after ${String(this.timeoutMs)}ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
