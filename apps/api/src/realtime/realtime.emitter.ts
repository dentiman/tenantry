import { Injectable, Logger } from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type {
  AiConversationChanged,
  CalendarEventChanged,
  NotificationChanged,
  NotificationCreated,
  PresenceChanged,
  ResyncReason,
  ServerToClientEvents,
} from '@saas-skeleton/contracts';
import {
  NotificationDispatcherRegistry,
  type NotificationDispatcher,
} from '@saas-skeleton/shared';
import { sessionRoom, tenantRoom, userRoom } from './realtime.constants';
import type { TenantNamespace } from './realtime.types';

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

  // ---- календар: в особисті room-и учасників (docs/calendar.md §9.3) ----

  /**
   * Один виклик на КОЖНОГО учасника, а не broadcast у tenant-room: подію бачать
   * лише її учасники, тож і дельта не має долітати до сторонніх — інакше сам
   * факт існування чужої зустрічі (з часом!) розсилався б усьому тенанту.
   */
  calendarEventChanged(
    tenantId: string,
    recipientIds: readonly string[],
    payload: CalendarEventChanged,
  ): void {
    for (const recipientId of recipientIds) {
      this.emit(userRoom(tenantId, recipientId), REALTIME_EVENTS.calendarEventChanged, payload);
    }
  }

  // ---- AI-0.1: «розмова змінилась», в особистий room юзера (design.md D7) ----

  /**
   * Сигнал без даних: реакція клієнта — одне дедупліковане перечитування
   * стрічки. Долітає в УСІ вкладки юзера, включно з тією, що ініціювала дію —
   * виключати її окремим socket id дорожче, ніж зайве (дедупліковане) перечитування.
   */
  aiConversationChanged(tenantId: string, userId: string, payload: AiConversationChanged): void {
    this.emit(userRoom(tenantId, userId), REALTIME_EVENTS.aiConversationChanged, payload);
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
