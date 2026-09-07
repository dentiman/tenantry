import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarAccessService } from './calendar.access';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

/**
 * Календар (docs/calendar.md). `SettingsModule` — за дефолтами компанії (зона,
 * тривалість, дефолтні нагадування); `ActivityRecorder`,
 * `NotificationRecorder` і `ScheduledNotificationService` приходять із
 * глобальних модулів `libs/shared`.
 */
@Module({
  // RealtimeModule — за `RealtimeEmitter` (дельти в room-и учасників). Напрямок
  // залежності саме такий: realtime свідомо не знає про доменні модулі
  imports: [SettingsModule, RealtimeModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarAccessService],
  exports: [CalendarService],
})
export class CalendarModule {}
