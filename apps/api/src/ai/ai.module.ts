import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/**
 * `AiModule` з `libs/shared` глобальний (конфіг, провайдер, канал скасування),
 * тому тут імпортувати нічого не треба — лише свої контролер і сервіс.
 */
@Module({
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
