import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { NumberingController } from './numbering.controller';

/**
 * Розділ «налаштування організації»: секція general + нумерація + журнал змін.
 * Сам NumberingService живе в libs/shared (його споживають домени), тут — лише
 * редактор поверх нього.
 */
@Module({
  // Журнал змін налаштувань читається тим самим сервісом, що й решта фідів
  imports: [ActivitiesModule],
  controllers: [SettingsController, NumberingController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
