import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Server, type Namespace } from 'socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import {
  REALTIME_DEFAULT_KEY_PREFIX,
  REALTIME_EVENTS,
  TENANT_NAMESPACE,
  realtimeSessionKeyPrefix,
  realtimeStreamName,
  userRoom,
  type ClientToServerEvents,
  type NotificationChanged,
  type NotificationCreated,
  type ServerToClientEvents,
} from '@saas-skeleton/contracts';
import { NotificationDispatcherRegistry, type NotificationDispatcher } from '@saas-skeleton/shared';

const DEFAULT_REDIS_URL = 'redis://:saas-realtime@localhost:6379';

/**
 * Міст «воркер → браузер».
 *
 * Частина сповіщень народжується тут (welcome, а далі всі нагадування), а сокетів
 * у воркера немає взагалі. Замість власного стріму `realtime.dispatch` (ранній
 * начерк EDA §3.12) піднімаємо **headless Socket.IO Server** — без `listen()`, без
 * жодного клієнта — на ТОМУ САМОМУ Valkey-адаптері, що розносить події між
 * репліками api. Емісія в room іде через adapter, тому доїжджає до клієнтів,
 * підключених до будь-якої репліки. Власний стрім був би переписуванням
 * транспорту, який уже працює (docs/notifications.md § «Міст із воркера»).
 *
 * Ключі стріму беруться з contracts: розійшовшись із api, воркер емітив би в
 * нікуди — тихо, без жодної помилки.
 */
@Injectable()
export class WorkerRealtimeEmitter
  implements NotificationDispatcher, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerRealtimeEmitter.name);
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private namespace: Namespace<ClientToServerEvents, ServerToClientEvents> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly registry: NotificationDispatcherRegistry) {}

  onModuleInit(): void {
    const keyPrefix = process.env.REALTIME_KEY_PREFIX ?? REALTIME_DEFAULT_KEY_PREFIX;
    const redis = new Redis(process.env.REDIS_URL ?? DEFAULT_REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times): number => Math.min(times * 200, 5_000),
    });
    // Без обробника ioredis кидає unhandled 'error' і валить процес — недоступний
    // брокер не має права зупиняти обробку черг
    redis.on('error', (error: Error) => {
      this.logger.warn(`Realtime broker connection error: ${error.message}`);
    });

    const io = new Server<ClientToServerEvents, ServerToClientEvents>({
      adapter: createAdapter(redis, {
        streamName: realtimeStreamName(keyPrefix),
        sessionKeyPrefix: realtimeSessionKeyPrefix(keyPrefix),
        maxLen: 10_000,
        // Той самий 1 с, що в api: це час, який блокуючий XREAD додає до виходу процесу
        blockTimeInMs: 1_000,
      }),
    });

    this.redis = redis;
    this.io = io;
    this.namespace = io.of(TENANT_NAMESPACE);
    this.registry.register(this);
    this.logger.log('Headless realtime emitter ready (no HTTP server, adapter only)');
  }

  created(tenantId: string, recipientId: string, payload: NotificationCreated): void {
    this.toUser(tenantId, recipientId, REALTIME_EVENTS.notificationCreated, payload);
  }

  changed(tenantId: string, recipientId: string, payload: NotificationChanged): void {
    this.toUser(tenantId, recipientId, REALTIME_EVENTS.notificationChanged, payload);
  }

  /**
   * Подія в особистий room юзера — для фіч, що оголосили свої події в контрактах
   * (`ai.message-delta.v1`, `ai.message-completed.v1`; docs/modules.md §7.2).
   * Realtime не знає, що це за події: тип payload-у — з протоколу `ServerToClientEvents`.
   */
  toUser<E extends keyof ServerToClientEvents>(
    tenantId: string,
    recipientId: string,
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void {
    if (!this.namespace) {
      this.logger.warn(`Realtime emitter is not ready, dropping "${event}"`);
      return;
    }
    this.namespace.to(userRoom(tenantId, recipientId)).emit(event, ...payload);
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      // Зупиняє блокуючий XREAD адаптера; HTTP-сервера тут немає, close це переживає
      await this.io?.close();
      await this.redis?.quit();
    } catch {
      this.redis?.disconnect();
    }
  }
}
