import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { REALTIME_CONFIG } from '../realtime.constants';
import type { RealtimeConfig } from '../realtime.config';
import {
  ACQUIRE_LEASE,
  READ_SNAPSHOT,
  RELEASE_LEASE,
  RENEW_LEASES,
  SWEEP_EXPIRED,
} from './presence.lua';

/** Скільки протермінованих юзерів забирає один прохід sweeper-а по тенанту */
const SWEEP_BATCH = 500;

/** Перехід стану, який store просить опублікувати як delta */
export interface PresenceTransition {
  userId: string;
  revision: number;
}

interface PresenceKeys {
  online: string;
  deadlines: string;
  revision: string;
  leasePrefix: string;
}

/**
 * ioredis не типізує кастомні команди з `defineCommand` — оголошуємо їх форму явно
 * і звужуємо клієнт один раз тут, а не касти на кожному виклику.
 */
interface PresenceCommands {
  rtAcquireLease(
    online: string,
    deadlines: string,
    revision: string,
    lease: string,
    userId: string,
    nodeId: string,
    expiresAtMs: string,
    ttlMs: string,
  ): Promise<[number, number]>;
  rtReleaseLease(
    online: string,
    deadlines: string,
    revision: string,
    lease: string,
    userId: string,
    nodeId: string,
  ): Promise<[number, number]>;
  rtRenewLeases(
    online: string,
    deadlines: string,
    revision: string,
    nodeId: string,
    expiresAtMs: string,
    leasePrefix: string,
    ttlMs: string,
    ...userIds: string[]
  ): Promise<(string | number)[]>;
  rtSweepExpired(
    online: string,
    deadlines: string,
    revision: string,
    nowMs: string,
    leasePrefix: string,
    limit: string,
  ): Promise<(string | number)[]>;
  rtReadSnapshot(online: string, revision: string): Promise<[string[], string]>;
}

type PresenceRedis = Redis & PresenceCommands;

/**
 * Сховище presence поверх Valkey. Свідомо НЕ Prisma-таблиця: дані ефемерні,
 * пишуться кожні 20 секунд на кожного онлайн-юзера і не мають жодної цінності
 * після рестарту — у Postgres це був би чистий churn на primary заради стану,
 * який відбудовується heartbeat-ами за один інтервал.
 *
 * Модель leases (docs/realtime-internals.md § «Presence: дані у Valkey»): живе не вкладка,
 * а пара `(user, apiNode)`. Юзер із 5 вкладками на 2 нодах — це 2 записи, а не 5.
 */
@Injectable()
export class PresenceStore implements OnModuleInit {
  private readonly redis: PresenceRedis;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(REALTIME_CONFIG) private readonly config: RealtimeConfig,
  ) {
    this.redis = redis as PresenceRedis;
  }

  onModuleInit(): void {
    // defineCommand кешує SHA і сам робить EVALSHA з фолбеком на EVAL при NOSCRIPT
    // (напр. після рестарту Valkey) — саме тому Lua тут, а не пачка окремих команд
    this.redis.defineCommand('rtAcquireLease', { numberOfKeys: 4, lua: ACQUIRE_LEASE });
    this.redis.defineCommand('rtReleaseLease', { numberOfKeys: 4, lua: RELEASE_LEASE });
    this.redis.defineCommand('rtRenewLeases', { numberOfKeys: 3, lua: RENEW_LEASES });
    this.redis.defineCommand('rtSweepExpired', { numberOfKeys: 3, lua: SWEEP_EXPIRED });
    this.redis.defineCommand('rtReadSnapshot', { numberOfKeys: 2, lua: READ_SNAPSHOT });
  }

  /**
   * Індекс тенантів, у яких хтось був онлайн. Лежить ПОЗА hash tag-ом тенанта
   * свідомо: sweeper мусить знайти тенанта, у якого на ЦІЙ ноді немає нікого
   * (нода з його юзерами впала) — інакше leases мертвої ноди ніхто не прибере.
   */
  private get tenantsKey(): string {
    return `${this.config.keyPrefix}:presence:tenants`;
  }

  private keys(tenantId: string): PresenceKeys {
    // Фігурні дужки — hash tag Redis Cluster: усі ключі тенанта в одному slot,
    // тому Lua-скрипти над ними лишаються атомарними і в кластері
    const base = `${this.config.keyPrefix}:presence:{${tenantId}}`;
    return {
      online: `${base}:online`,
      deadlines: `${base}:deadlines`,
      revision: `${base}:revision`,
      leasePrefix: `${base}:leases:`,
    };
  }

  /** Час життя ключа leases: із запасом більший за TTL самої lease */
  private get leaseKeyTtlMs(): number {
    return this.config.leaseTtlMs * 3;
  }

  private toTransitions(flat: (string | number)[]): PresenceTransition[] {
    const transitions: PresenceTransition[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      transitions.push({ userId: String(flat[i]), revision: Number(flat[i + 1]) });
    }
    return transitions;
  }

  /** Перша локальна вкладка юзера на цій ноді. changed=true → юзер щойно став online */
  async acquireLease(
    tenantId: string,
    userId: string,
    nodeId: string,
  ): Promise<{ changed: boolean; revision: number }> {
    const keys = this.keys(tenantId);
    const expiresAt = Date.now() + this.config.leaseTtlMs;
    await this.redis.sadd(this.tenantsKey, tenantId);
    const [changed, revision] = await this.redis.rtAcquireLease(
      keys.online,
      keys.deadlines,
      keys.revision,
      `${keys.leasePrefix}${userId}`,
      userId,
      nodeId,
      String(expiresAt),
      String(this.leaseKeyTtlMs),
    );
    return { changed: changed === 1, revision };
  }

  /** Остання локальна вкладка закрилась. changed=true → юзера більше немає ніде */
  async releaseLease(
    tenantId: string,
    userId: string,
    nodeId: string,
  ): Promise<{ changed: boolean; revision: number }> {
    const keys = this.keys(tenantId);
    const [changed, revision] = await this.redis.rtReleaseLease(
      keys.online,
      keys.deadlines,
      keys.revision,
      `${keys.leasePrefix}${userId}`,
      userId,
      nodeId,
    );
    return { changed: changed === 1, revision };
  }

  /** Batch-продовження leases усіх локальних юзерів одного тенанта */
  async renewLeases(
    tenantId: string,
    userIds: string[],
    nodeId: string,
  ): Promise<PresenceTransition[]> {
    if (userIds.length === 0) {
      return [];
    }
    const keys = this.keys(tenantId);
    const expiresAt = Date.now() + this.config.leaseTtlMs;
    const restored = await this.redis.rtRenewLeases(
      keys.online,
      keys.deadlines,
      keys.revision,
      nodeId,
      String(expiresAt),
      keys.leasePrefix,
      String(this.leaseKeyTtlMs),
      ...userIds,
    );
    return this.toTransitions(restored);
  }

  /** Прибирає протерміновані leases тенанта; повертає юзерів, що стали offline */
  async sweepExpired(tenantId: string): Promise<PresenceTransition[]> {
    const keys = this.keys(tenantId);
    const offline = await this.redis.rtSweepExpired(
      keys.online,
      keys.deadlines,
      keys.revision,
      String(Date.now()),
      keys.leasePrefix,
      String(SWEEP_BATCH),
    );
    return this.toTransitions(offline);
  }

  async listTenants(): Promise<string[]> {
    return this.redis.smembers(this.tenantsKey);
  }

  /** Тенант без жодного онлайн-юзера прибирається з індексу — інакше він росте вічно */
  async forgetTenantIfEmpty(tenantId: string): Promise<void> {
    const keys = this.keys(tenantId);
    if ((await this.redis.scard(keys.online)) === 0) {
      await this.redis.srem(this.tenantsKey, tenantId);
    }
  }

  async readSnapshot(tenantId: string): Promise<{ onlineUserIds: string[]; revision: number }> {
    const keys = this.keys(tenantId);
    const [onlineUserIds, revision] = await this.redis.rtReadSnapshot(keys.online, keys.revision);
    return { onlineUserIds, revision: Number(revision) };
  }
}
