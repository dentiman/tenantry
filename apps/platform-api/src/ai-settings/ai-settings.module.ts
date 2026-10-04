import { Module } from '@nestjs/common';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';

@Module({
  controllers: [AiSettingsController],
  providers: [AiSettingsService],
})
export class AiSettingsModule {}
