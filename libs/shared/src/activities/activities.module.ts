import { Global, Module } from '@nestjs/common';
import { ActivityRecorder } from './activity-recorder.service';

/** Глобальний (як StorageModule): recorder — інфраструктура api і worker */
@Global()
@Module({
  providers: [ActivityRecorder],
  exports: [ActivityRecorder],
})
export class ActivitiesModule {}
