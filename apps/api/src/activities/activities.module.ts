import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityAccessRegistry } from './activity-access.registry';

@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService, ActivityAccessRegistry],
  // Фід воркспейсу (`GET /workspace/activity`) переюзовує той самий сервіс:
  // друга реалізація keyset-пагінації нам не потрібна
  // Реєстр — для доменів, що мають приватні записи: вони реєструють охоронця сутності
  // зі свого onModuleInit (docs/modules.md §4.2), activities їх не імпортує
  exports: [ActivitiesService, ActivityAccessRegistry],
})
export class ActivitiesModule {}
