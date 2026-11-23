import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarActivityGuard } from './calendar-activity.guard';
import { CalendarAccessService } from './calendar.access';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarSettingsController } from './calendar-settings.controller';
import { CalendarSettingsService } from './calendar-settings.service';

/**
 * Календар (docs/calendar.md). `SettingsModule` — сховище секції `settings.calendar`
 * (дефолти компанії: зона, тривалість, нагадування) і внесок у bootstrap; схему секції
 * й ендпоінти тримає сам календар (`CalendarSettingsService`, docs/modules.md §4); `ActivityRecorder`,
 * `NotificationRecorder` і `ScheduledNotificationService` приходять із
 * глобальних модулів `libs/shared`.
 */
@Module({
  // RealtimeModule — за `RealtimeEmitter` (дельти в room-и учасників). Напрямок
  // залежності саме такий: realtime свідомо не знає про доменні модулі
  // ActivitiesModule — реєстр доступу до стрічки: приватні події календаря з неї ховаються
  imports: [SettingsModule, RealtimeModule, ActivitiesModule],
  controllers: [CalendarController, CalendarSettingsController],
  providers: [
    CalendarService,
    CalendarAccessService,
    CalendarSettingsService,
    CalendarActivityGuard,
  ],
  exports: [CalendarService],
})
export class CalendarModule {}
