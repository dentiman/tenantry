import { Injectable, Logger } from '@nestjs/common';
import type { UserOperationChanged } from '@saas-skeleton/contracts';

/**
 * Доставка «операція змінилась» у відкриті вкладки власника. Той самий прийом, що
 * `NotificationDispatcherRegistry`: інтерфейс тут, реалізацію реєструє процес, у якого є сокет
 * (`apps/api` — свій `RealtimeEmitter`, `apps/worker` — headless-емітер). Без неї все працює,
 * просто без push-у: правда в `GET /user-operations/:id`.
 */
export interface UserOperationEvents {
  changed(tenantId: string, userId: string, payload: UserOperationChanged): void;
}

@Injectable()
export class UserOperationEventsRegistry implements UserOperationEvents {
  private readonly logger = new Logger(UserOperationEventsRegistry.name);
  private impl: UserOperationEvents | null = null;

  register(impl: UserOperationEvents): void {
    this.impl = impl;
  }

  changed(tenantId: string, userId: string, payload: UserOperationChanged): void {
    if (!this.impl) {
      this.logger.debug('No realtime transport registered — skipping user-operation push');
      return;
    }
    this.impl.changed(tenantId, userId, payload);
  }
}
