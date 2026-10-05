import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
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
  imports: [SettingsModule, RealtimeModule],
  controllers: [CalendarController, CalendarSettingsController],
  providers: [CalendarService, CalendarAccessService, CalendarSettingsService],
  exports: [CalendarService],
})
export class CalendarModule {}
