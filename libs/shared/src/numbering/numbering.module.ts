import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/**
 * Глобальний, як ActivitiesModule і NotificationsModule: нумерація — інфраструктура,
 * якою користуються різні доменні модулі (кастомери зараз, документи далі).
 */
@Global()
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
