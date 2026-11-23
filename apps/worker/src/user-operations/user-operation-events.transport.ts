import { Injectable, type OnModuleInit } from '@nestjs/common';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import { UserOperationEventsRegistry } from '@saas-skeleton/shared';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

/**
 * Транспорт `user-operation.changed.v1` у воркері: зміни, які робить runner і sweeper, ідуть у
 * особистий room власника через headless-емітер на тому самому Valkey-адаптері, що й у api.
 */
@Injectable()
export class UserOperationEventsTransport implements OnModuleInit {
  constructor(
    private readonly registry: UserOperationEventsRegistry,
    private readonly emitter: WorkerRealtimeEmitter,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      changed: (tenantId, userId, payload) => {
        this.emitter.toUser(tenantId, userId, REALTIME_EVENTS.userOperationChanged, payload);
      },
    });
  }
}
