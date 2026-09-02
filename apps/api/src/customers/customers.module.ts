import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  // Дефолтна валюта нового кастомера — з налаштувань компанії
  imports: [SettingsModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
