import { Injectable, Logger } from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type {
  NotificationChanged,
  NotificationCreated,
  PresenceChanged,
  ResyncReason,
  ServerToClientEvents,
} from '@saas-skeleton/contracts';
import { NotificationDispatcherRegistry, type NotificationDispatcher } from '@saas-skeleton/shared';
import { sessionRoom, tenantRoom, userRoom } from './realtime.constants';
import type { TenantNamespace } from './realtime.types';

/** Стеля очікування відповіді adapter-а на запит про сокети room-а */
const ROOM_QUERY_TIMEOUT_MS = 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Тонкий шар між доменною логікою realtime (presence) і Socket.IO namespace-ом.
 * Потрібен рівно з однієї причини: gateway отримує namespace лише в `afterInit`,
 * а сервіси, які емітять, створюються раніше — без цього посередника вийшов би
 * цикл залежностей gateway ↔ presence service.
 *
 * Емісія в room завжди йде через adapter, тому подія доїжджає і до клієнтів,
 * підключених до ІНШОЇ репліки api.
 */
@Injectable()
export class RealtimeEmitter implements NotificationDispatcher {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private namespace: TenantNamespace | null = null;

  constructor(
    dispatcherRegistry: NotificationDispatcherRegistry,
    private readonly tenantContext: TenantContextService,
  ) {
    // Інбокс живе в libs/shared і про socket.io не знає — транспорт віддається
    // йому тут (той самий прийом пізньої реєстрації, що з namespace нижче)
    dispatcherRegistry.register(this);
  }

  register(namespace: TenantNamespace): void {
    this.namespace = namespace;
  }

  private emit<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void {
    if (!this.namespace) {
      // Не кидаємо: втрата delta не втрачає стан — клієнт зійдеться на snapshot-і
      this.logger.warn(`Realtime namespace is not ready yet, dropping "${event}"`);
      return;
    }
    this.namespace.to(room).emit(event, ...payload);
  }

  presenceChanged(tenantId: string, payload: PresenceChanged): void {
    this.emit(tenantRoom(tenantId), REALTIME_EVENTS.presenceChanged, payload);
  }

  resyncRequired(tenantId: string, reason: ResyncReason): void {
    this.emit(tenantRoom(tenantId), REALTIME_EVENTS.resyncRequired, {
      reason,
      occurredAt: new Date().toISOString(),
    });
  }

  // ---- NotificationDispatcher: в особистий room, тобто в усі вкладки юзера ----

  created(tenantId: string, recipientId: string, payload: NotificationCreated): void {
    this.emit(userRoom(tenantId, recipientId), REALTIME_EVENTS.notificationCreated, payload);
  }

  changed(tenantId: string, recipientId: string, payload: NotificationChanged): void {
    this.emit(userRoom(tenantId, recipientId), REALTIME_EVENTS.notificationChanged, payload);
  }

  /**
   * Подія в room ТЕНАНТА — усім його підключеним сокетам. Лише для сигналів «перечитай» без даних
   * (`chat.inbox-changed.v1`, `chat.message-updated.v1`): клієнтську розмову бачать усі, а payload зі
   * станом у такий широкий room не йде (AGENTS.md №15).
   */
  toTenant<E extends keyof ServerToClientEvents>(
    tenantId: string,
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void {
    this.emit(tenantRoom(tenantId), event, ...payload);
  }

  // ---- події фіч: в особисті room-и (docs/modules.md §7.2) ----

  /**
   * Подія в особисті room-и юзерів — для фіч, що оголосили свої події в контрактах
   * (`calendar.event-changed.v1`, `ai.conversation-changed.v1`). Realtime не знає, що це
   * за події: тип payload-у береться з протоколу `ServerToClientEvents`, який збирає root.
   *
   * Один emit на КОЖНОГО отримувача, а не broadcast у tenant-room: подію бачать лише ті,
   * кому вона адресована, — інакше сам факт існування чужої зустрічі (з часом!)
   * розсилався б усьому тенанту.
   */
  toUsers<E extends keyof ServerToClientEvents>(
    tenantId: string,
    userIds: readonly string[],
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const userId of userIds) {
      this.emit(userRoom(tenantId, userId), event, ...payload);
    }
  }

  /**
   * Хто зараз у room-і (CHAT-0.2c, docs/chat.md §4.11): різні `userId` сокетів, що в ньому сидять.
   * Для чату це відповідь «хто дивиться на розмову»: сокет потрапляє в room розмови лише після
   * `chat.subscribe.v1`, тож просто підключена вкладка — не глядач.
   *
   * Запит іде через adapter, тобто бачить і репліки api. FAIL-OPEN: таймаут, помилка чи ще не
   * готовий namespace дають `[]`, і тоді сповіщення отримають усі — краще зайве, ніж мовчки
   * пропущене. Кличеться ДО транзакції, бо це зовнішній виклик (backend-conventions §5).
   */
  async userIdsInRoom(room: string): Promise<string[]> {
    if (!this.namespace) {
      return [];
    }
    const namespace = this.namespace;
    try {
      const sockets = await withTimeout(namespace.in(room).fetchSockets(), ROOM_QUERY_TIMEOUT_MS);
      return [...new Set(sockets.map((socket) => socket.data.userId))];
    } catch (error) {
      this.logger.warn(
        `Could not list sockets of room "${room}", assuming nobody is viewing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  // ---- AUTH-1: примусовий розрив зʼєднань відкликаної сесії ----

  /**
   * Tenant беремо з CLS, а НЕ аргументом. Ці два методи кличе доменний код
   * (account, users), а йому tenantId не належить за конституцією §I — там його
   * взагалі не видно. Інфраструктурний сервіс має право дістати його сам.
   */
  disconnectSession(sid: string): void {
    this.disconnectRoom(sessionRoom(this.tenantContext.requireTenantId(), sid), `session ${sid}`);
  }

  disconnectUser(userId: string): void {
    this.disconnectRoom(userRoom(this.tenantContext.requireTenantId(), userId), `user ${userId}`);
  }

  /**
   * `disconnectSockets(true)` через adapter — тобто рве і зʼєднання, підключені до
   * ІНШИХ реплік api: без цього «завершити сесію» працювало б лише тоді, коли
   * пристрій випадково тримає socket на тій самій ноді, що обробила HTTP-запит.
   *
   * Межа чесна і записана в UI: миттєво рветься realtime, а вже виданий
   * access-токен stateless і догорає до 15 хвилин (denylist — окреме рішення).
   */
  private disconnectRoom(room: string, subject: string): void {
    if (!this.namespace) {
      this.logger.warn(`Realtime namespace is not ready yet, cannot disconnect ${subject}`);
      return;
    }
    this.namespace.in(room).disconnectSockets(true);
    this.logger.log(`Disconnected realtime sockets of ${subject}`);
  }
}
