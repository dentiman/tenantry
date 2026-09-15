import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** @Global(), як StorageModule: обидва процеси-споживачі (api, worker) підключають один раз */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
