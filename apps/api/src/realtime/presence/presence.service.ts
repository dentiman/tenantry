import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PresenceSnapshot, PresenceStatus } from '@saas-skeleton/contracts';
import { REALTIME_CONFIG } from '../realtime.constants';
import type { RealtimeConfig } from '../realtime.config';
import { RealtimeEmitter } from '../realtime.emitter';
import { PresenceStore, type PresenceTransition } from './presence.store';

/** Локальна мапа ноди: tenantId → userId → socketId-и цієї ноди */
type LocalPresence = Map<string, Map<string, Set<string>>>;

/**
 * Presence як розподілена задача (docs/realtime-internals.md § «Presence: життєвий цикл»).
 *
 * Бізнес-визначення: юзер `online`, якщо існує хоч ОДНЕ живе socket-зʼєднання цього
 * юзера в цьому тенанті. Дві вкладки — один online user; закриття однієї з двох
 * offline не дає. Це не «активна вкладка»: вимога — CRM відкрита, а не видима.
 *
 * Розподіленість зведена до двох рівнів:
 *  - локальний (у памʼяті ноди) рахунок вкладок — не потребує мережі взагалі;
 *  - глобальний (Valkey) lease пари `(user, node)` — тільки на переходах 0↔1.
 * Тому юзер із 5 вкладками генерує один запис у Valkey і один heartbeat, а не пʼять.
 */
@Injectable()
export class PresenceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PresenceService.name);
  /**
   * Boot UUID, а НЕ hostname: два процеси api на одному хості (dev-watch, або
   * `start-first` під час rolling update у swarm) мають різні leases. З hostname
   * новий таск перезаписав би lease старого, і drain старого зняв би юзера,
   * який уже сидить на новому.
   */
  private readonly nodeId = randomUUID();
  private readonly local: LocalPresence = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private brokerDegraded = false;

  constructor(
    private readonly store: PresenceStore,
    private readonly emitter: RealtimeEmitter,
    @Inject(REALTIME_CONFIG) private readonly config: RealtimeConfig,
  ) {}

  onApplicationBootstrap(): void {
    // unref: таймери не мають самі по собі тримати процес живим (важливо для e2e)
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, this.config.heartbeatMs);
    this.heartbeatTimer.unref();

    // Sweeper крутиться на КОЖНІЙ ноді без вибору лідера: перехід у Lua робить SREM,
    // який повертає 1 рівно один раз, скільки б нод не мели одночасно
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, this.config.sweepMs);
    this.sweepTimer.unref();

    this.logger.log(
      `Presence node ${this.nodeId} started (lease ${String(this.config.leaseTtlMs)}ms, ` +
        `heartbeat ${String(this.config.heartbeatMs)}ms, sweep ${String(this.config.sweepMs)}ms)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    await this.drain();
  }

  // ------------------------------------------------------------ connections

  /**
   * Викликається на КОЖЕН connect. Мережа зачіпається лише на першій локальній
   * вкладці юзера — решта змінює тільки in-memory set.
   */
  async onConnect(tenantId: string, userId: string, socketId: string): Promise<void> {
    const sockets = this.localSockets(tenantId, userId);
    const isFirstLocal = sockets.size === 0;
    sockets.add(socketId);
    if (!isFirstLocal) {
      return;
    }

    await this.withBroker('acquireLease', async () => {
      const { changed, revision } = await this.store.acquireLease(tenantId, userId, this.nodeId);
      if (changed) {
        this.publish(tenantId, userId, 'online', revision);
      }
    });
  }

  /**
   * Розрив, про який невідомо, чи він навмисний (`transport close`, `ping timeout`).
   * Локальний облік знімаємо — heartbeat більше не продовжуватиме lease, — але саму
   * lease НЕ віддаємо: якщо клієнт повернеться протягом TTL, offline не станеться
   * взагалі. Ціна короткого розриву — нуль подій замість пари offline/online.
   */
  forgetSocket(tenantId: string, userId: string, socketId: string): void {
    this.removeLocal(tenantId, userId, socketId);
  }

  async onDisconnect(tenantId: string, userId: string, socketId: string): Promise<void> {
    if (!this.removeLocal(tenantId, userId, socketId)) {
      return;
    }

    await this.withBroker('releaseLease', async () => {
      const { changed, revision } = await this.store.releaseLease(tenantId, userId, this.nodeId);
      if (changed) {
        this.publish(tenantId, userId, 'offline', revision);
      }
    });
  }

  // ------------------------------------------------------------ snapshot

  /**
   * Snapshot для `GET /api/presence`. При недоступному брокері свідомо КИДАЄ 503,
   * а не повертає порожній список: порожній список фронт відрендерив би як
   * «всі offline», тобто збрехав би. Помилка дає чесний стан «невідомо».
   */
  async snapshot(tenantId: string): Promise<PresenceSnapshot> {
    try {
      const { onlineUserIds, revision } = await this.store.readSnapshot(tenantId);
      this.markHealthy();
      return { onlineUserIds, revision, generatedAt: new Date().toISOString() };
    } catch (error) {
      this.markDegraded('readSnapshot', error);
      throw new ServiceUnavailableException('Presence is temporarily unavailable');
    }
  }

  // ------------------------------------------------------------ background

  /** Batch-продовження leases усіх локальних юзерів — один виклик на тенант */
  private async heartbeat(): Promise<void> {
    for (const [tenantId, users] of this.local) {
      const userIds = [...users.keys()];
      await this.withBroker('renewLeases', async () => {
        const restored = await this.store.renewLeases(tenantId, userIds, this.nodeId);
        this.publishAll(tenantId, restored, 'online');
      });
    }
  }

  /**
   * Прибирання протермінованих leases. Ловить саме ті випадки, де disconnect знати
   * неможливо: `kill -9` ноди, зникла мережа, заснув ноутбук.
   *
   * Обходить ВСІ тенанти з індексу, а не лише локальні: якщо впала нода, на якій
   * сидів єдиний юзер тенанта, локально про цей тенант тут не знає ніхто.
   */
  private async sweep(): Promise<void> {
    let tenantIds: string[];
    try {
      tenantIds = await this.store.listTenants();
      this.markHealthy();
    } catch (error) {
      this.markDegraded('listTenants', error);
      return;
    }

    for (const tenantId of tenantIds) {
      await this.withBroker('sweepExpired', async () => {
        const offline = await this.store.sweepExpired(tenantId);
        this.publishAll(tenantId, offline, 'offline');
        if (offline.length > 0) {
          await this.store.forgetTenantIfEmpty(tenantId);
        }
      });
    }
  }

  /**
   * Graceful shutdown: нода віддає свої leases САМА, не чекаючи TTL. Без цього
   * кожен rolling deploy лишав би «привидів» online на хвилину — рівно тоді,
   * коли всі клієнти перепідключаються і дивляться на список.
   */
  private async drain(): Promise<void> {
    const snapshot = [...this.local.entries()].map(
      ([tenantId, users]) => [tenantId, [...users.keys()]] as const,
    );
    this.local.clear();

    for (const [tenantId, userIds] of snapshot) {
      for (const userId of userIds) {
        try {
          const { changed, revision } = await this.store.releaseLease(
            tenantId,
            userId,
            this.nodeId,
          );
          if (changed) {
            this.publish(tenantId, userId, 'offline', revision);
          }
        } catch (error) {
          // Драйн не має права заблокувати зупинку процесу: leases догорять по TTL
          this.logger.warn(
            `Failed to release lease for user ${userId} during drain: ${String(error)}`,
          );
        }
      }
    }
  }

  // ------------------------------------------------------------ internals

  /** Прибирає сокет із локальної мапи; true — це була ОСТАННЯ вкладка юзера на цій ноді */
  private removeLocal(tenantId: string, userId: string, socketId: string): boolean {
    const users = this.local.get(tenantId);
    const sockets = users?.get(userId);
    if (!users || !sockets) {
      return false;
    }
    sockets.delete(socketId);
    if (sockets.size > 0) {
      return false;
    }
    users.delete(userId);
    if (users.size === 0) {
      this.local.delete(tenantId);
    }
    return true;
  }

  private localSockets(tenantId: string, userId: string): Set<string> {
    let users = this.local.get(tenantId);
    if (!users) {
      users = new Map();
      this.local.set(tenantId, users);
    }
    let sockets = users.get(userId);
    if (!sockets) {
      sockets = new Set();
      users.set(userId, sockets);
    }
    return sockets;
  }

  private publish(
    tenantId: string,
    userId: string,
    status: PresenceStatus,
    revision: number,
  ): void {
    this.emitter.presenceChanged(tenantId, {
      userId,
      status,
      revision,
      occurredAt: new Date().toISOString(),
    });
  }

  private publishAll(
    tenantId: string,
    transitions: PresenceTransition[],
    status: PresenceStatus,
  ): void {
    for (const { userId, revision } of transitions) {
      this.publish(tenantId, userId, status, revision);
    }
  }

  /**
   * Уніфікована деградація: відмова брокера НЕ валить HTTP-запит і не рве socket.
   * Realtime — додатковий канал; єдине джерело правди присутності зійдеться на
   * наступному snapshot-і.
   */
  private async withBroker(operation: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.markHealthy();
    } catch (error) {
      this.markDegraded(operation, error);
    }
  }

  private markDegraded(operation: string, error: unknown): void {
    if (!this.brokerDegraded) {
      this.brokerDegraded = true;
      this.logger.error(`Realtime broker degraded during ${operation}: ${String(error)}`);
    }
  }

  /**
   * Повернення брокера — привід попросити клієнтів перечитати snapshot: поки він
   * лежав, частина переходів не доїхала, і ревізії клієнтів могли розʼїхатись.
   */
  private markHealthy(): void {
    if (!this.brokerDegraded) {
      return;
    }
    this.brokerDegraded = false;
    this.logger.log('Realtime broker recovered, asking connected tenants to resync');
    for (const tenantId of this.local.keys()) {
      this.emitter.resyncRequired(tenantId, 'broker-degraded');
    }
  }
}
