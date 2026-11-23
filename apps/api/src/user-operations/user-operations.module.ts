import { Module, type OnModuleInit } from '@nestjs/common';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import { UserOperationEventsRegistry } from '@saas-skeleton/shared';
import { RealtimeModule } from '../realtime/realtime.module';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { UserOperationsController } from './user-operations.controller';
import { UserOperationsReadService } from './user-operations-read.service';

/**
 * HTTP-половина операцій користувача. Створення й переходи — у `libs/shared/user-operations`
 * (ними користуються і доменні модулі api, і воркер); тут читання власником, скасування й
 * транспорт `user-operation.changed.v1` для змін, зроблених у цьому процесі (скасування,
 * старт).
 */
@Module({
  imports: [RealtimeModule],
  controllers: [UserOperationsController],
  providers: [UserOperationsReadService],
})
export class UserOperationsModule implements OnModuleInit {
  constructor(
    private readonly registry: UserOperationEventsRegistry,
    private readonly emitter: RealtimeEmitter,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      changed: (tenantId, userId, payload) => {
        this.emitter.toUsers(tenantId, [userId], REALTIME_EVENTS.userOperationChanged, payload);
      },
    });
  }
}
