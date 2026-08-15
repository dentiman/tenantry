import { Injectable, Logger } from '@nestjs/common';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type { PresenceChanged, ResyncReason, ServerToClientEvents } from '@saas-skeleton/contracts';
import { tenantRoom } from './realtime.constants';
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
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private namespace: TenantNamespace | null = null;

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
}
