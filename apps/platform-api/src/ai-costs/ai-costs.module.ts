import { Module } from '@nestjs/common';
import { AiCostsController } from './ai-costs.controller';
import { AiCostsService } from './ai-costs.service';
import { AiPricesService } from './ai-prices.service';

@Module({
  controllers: [AiCostsController],
  providers: [AiCostsService, AiPricesService],
})
export class AiCostsModule {}
