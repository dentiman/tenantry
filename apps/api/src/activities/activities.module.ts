import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  // Фід воркспейсу (`GET /workspace/activity`) переюзовує той самий сервіс:
  // друга реалізація keyset-пагінації нам не потрібна
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
