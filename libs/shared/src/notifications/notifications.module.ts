import { Global, Module } from '@nestjs/common';
import { NotificationDispatcherRegistry } from './notification-dispatcher';
import { NotificationRecorder } from './notification-recorder.service';
import { NotificationStateService } from './notification-state.service';
import { ScheduledNotificationService } from './scheduled-notification.service';

/**
 * Глобальний (як ActivitiesModule і StorageModule): інбокс — інфраструктура,
 * доступна і api, і worker. Транспорт (socket) реєструється в реєстрі пізніше
 * тим процесом, у якого він є; без нього все працює, просто без push-у.
 */
@Global()
@Module({
  providers: [
    NotificationRecorder,
    NotificationStateService,
    NotificationDispatcherRegistry,
    ScheduledNotificationService,
  ],
  exports: [
    NotificationRecorder,
    NotificationStateService,
    NotificationDispatcherRegistry,
    ScheduledNotificationService,
  ],
})
export class NotificationsModule {}
