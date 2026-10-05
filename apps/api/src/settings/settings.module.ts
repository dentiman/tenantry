import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { NumberingController } from './numbering.controller';
import { BootstrapFeatures } from './bootstrap-features';

/**
 * Розділ «налаштування організації»: секція general + нумерація + журнал змін.
 * Сам NumberingService живе в libs/shared (його споживають домени), тут — лише
 * редактор поверх нього.
 */
@Module({
  // Журнал змін налаштувань читається тим самим сервісом, що й решта фідів
  imports: [ActivitiesModule],
  controllers: [SettingsController, NumberingController],
  providers: [SettingsService, BootstrapFeatures],
  // Для фіч: секції `Tenant.settings` (`updateSection`) і прапорці bootstrap —
  // settings їх не імпортує, фічі реєструються самі (docs/modules.md §4)
  exports: [SettingsService, BootstrapFeatures],
})
export class SettingsModule {}
