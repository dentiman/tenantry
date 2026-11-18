import { Global, Module } from '@nestjs/common';
import { UserOperationEventsRegistry } from './user-operation-events';
import { UserOperationRunner } from './user-operation-runner';
import { UserOperationsService } from './user-operations.service';

/**
 * Глобальний, як NotificationsModule: операції створюють доменні модулі в api, а виконує воркер.
 * Транспорт сокета реєструє процес, у якого він є (`UserOperationEventsRegistry.register`).
 */
@Global()
@Module({
  providers: [UserOperationsService, UserOperationRunner, UserOperationEventsRegistry],
  exports: [UserOperationsService, UserOperationRunner, UserOperationEventsRegistry],
})
export class UserOperationsModule {}
