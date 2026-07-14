import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Глобальний (як PrismaModule): сховище — інфраструктурна залежність API і worker-а */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
