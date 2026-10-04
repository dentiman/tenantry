import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  AiModelPriceHistoryResponse,
  AiModelPriceListResponse,
  AiModelPriceResponse,
  AiModelPriceSyncResponse,
  AiUsageEventListResponse,
  PlatformAiCostsBreakdownResponse,
  PlatformAiCostsSummaryResponse,
} from '@saas-skeleton/contracts/platform';
import {
  CurrentOperator,
  type PlatformJwtPayload,
} from '../auth/decorators/current-operator.decorator';
import { AiCostsService } from './ai-costs.service';
import { AiPricesService } from './ai-prices.service';
import {
  AiModelPriceHistoryQueryDto,
  AiModelPriceHistoryResponseDto,
  AiModelPriceListResponseDto,
  AiModelPriceQueryDto,
  AiModelPriceResponseDto,
  AiModelPriceSyncResponseDto,
  AiUsageEventListResponseDto,
  AiUsageEventQueryDto,
  CreateAiModelPriceDto,
  PlatformAiCostsBreakdownQueryDto,
  PlatformAiCostsBreakdownResponseDto,
  PlatformAiCostsQueryDto,
  PlatformAiCostsSummaryResponseDto,
} from './dto/ai-costs.dto';

/**
 * Журнал витрат і тарифи AI (AI-5b). Лише control plane: звітність бачить суперадмін
 * (рішення власника, docs/ai-platform-controls.md §1), tenant-контракти не змінюються.
 */
@ApiTags('ai-costs')
@ApiBearerAuth()
@Controller('ai')
export class AiCostsController {
  constructor(
    private readonly costs: AiCostsService,
    private readonly prices: AiPricesService,
  ) {}

  @Get('costs/summary')
  @ApiOkResponse({ type: PlatformAiCostsSummaryResponseDto.Output })
  summary(@Query() query: PlatformAiCostsQueryDto): Promise<PlatformAiCostsSummaryResponse> {
    return this.costs.summary(query);
  }

  @Get('costs/breakdown')
  @ApiOkResponse({ type: PlatformAiCostsBreakdownResponseDto.Output })
  breakdown(
    @Query() query: PlatformAiCostsBreakdownQueryDto,
  ): Promise<PlatformAiCostsBreakdownResponse> {
    return this.costs.breakdown(query);
  }

  @Get('costs/events')
  @ApiOkResponse({ type: AiUsageEventListResponseDto.Output })
  events(@Query() query: AiUsageEventQueryDto): Promise<AiUsageEventListResponse> {
    return this.costs.events(query);
  }

  @Get('prices')
  @ApiOkResponse({ type: AiModelPriceListResponseDto.Output })
  listPrices(@Query() query: AiModelPriceQueryDto): Promise<AiModelPriceListResponse> {
    return this.prices.list(query);
  }

  @Get('prices/history')
  @ApiOkResponse({ type: AiModelPriceHistoryResponseDto.Output })
  priceHistory(@Query() query: AiModelPriceHistoryQueryDto): Promise<AiModelPriceHistoryResponse> {
    return this.prices.history(query);
  }

  @Post('prices')
  @ApiCreatedResponse({ type: AiModelPriceResponseDto.Output })
  createPrice(
    @Body() dto: CreateAiModelPriceDto,
    @CurrentOperator() operator: PlatformJwtPayload,
  ): Promise<AiModelPriceResponse> {
    return this.prices.create(dto, operator);
  }

  /** Синхронно: публічні списки OpenRouter без ключа, мережа — до будь-якого запису */
  @Post('prices/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AiModelPriceSyncResponseDto.Output })
  syncPrices(@CurrentOperator() operator: PlatformJwtPayload): Promise<AiModelPriceSyncResponse> {
    return this.prices.sync(operator);
  }
}
