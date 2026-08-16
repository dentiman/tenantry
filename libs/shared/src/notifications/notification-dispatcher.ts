import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChanged, NotificationCreated } from '@saas-skeleton/contracts';

/**
 * Доставка сповіщення у відкриту вкладку. Інтерфейс живе тут, реалізації — у
 * процесах: `apps/api` віддає його своєму `RealtimeEmitter`, `apps/worker` —
 * headless Socket.IO-серверу на тому самому Valkey-адаптері.
 *
 * `libs/shared` свідомо НЕ залежить від socket.io: інбокс має працювати і там,
 * де realtime не піднятий (e2e без брокера, скрипти) — просто без push-у.
 */
export interface NotificationDispatcher {
  created(tenantId: string, recipientId: string, payload: NotificationCreated): void;
  changed(tenantId: string, recipientId: string, payload: NotificationChanged): void;
}

/**
 * Пізня реєстрація реалізації — той самий прийом, що в `RealtimeEmitter.register()`:
 * recorder створюється разом із доменними сервісами, а транспорт стає доступним
 * пізніше (і в частині процесів не стає взагалі).
 *
 * Відсутній транспорт — це НЕ помилка: socket-подія лише прискорює, джерелом
 * правди лишається REST + Postgres.
 */
@Injectable()
export class NotificationDispatcherRegistry implements NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcherRegistry.name);
  private impl: NotificationDispatcher | null = null;

  register(impl: NotificationDispatcher): void {
    this.impl = impl;
  }

  created(tenantId: string, recipientId: string, payload: NotificationCreated): void {
    if (!this.impl) {
      this.logger.debug('No realtime dispatcher registered — skipping notification push');
      return;
    }
    this.impl.created(tenantId, recipientId, payload);
  }

  changed(tenantId: string, recipientId: string, payload: NotificationChanged): void {
    if (!this.impl) {
      return;
    }
    this.impl.changed(tenantId, recipientId, payload);
  }
}
