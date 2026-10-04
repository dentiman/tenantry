import { createZodDto } from 'nestjs-zod';
import {
  AiModelPriceHistoryQuerySchema,
  AiModelPriceHistoryResponseSchema,
  AiModelPriceListResponseSchema,
  AiModelPriceQuerySchema,
  AiModelPriceResponseSchema,
  AiModelPriceSyncResponseSchema,
  AiUsageEventListResponseSchema,
  AiUsageEventQuerySchema,
  CreateAiModelPriceSchema,
  PlatformAiCostsBreakdownQuerySchema,
  PlatformAiCostsBreakdownResponseSchema,
  PlatformAiCostsQuerySchema,
  PlatformAiCostsSummaryResponseSchema,
} from '@saas-skeleton/contracts/platform';

export class PlatformAiCostsQueryDto extends createZodDto(PlatformAiCostsQuerySchema) {}
export class PlatformAiCostsBreakdownQueryDto extends createZodDto(
  PlatformAiCostsBreakdownQuerySchema,
) {}
export class PlatformAiCostsSummaryResponseDto extends createZodDto(
  PlatformAiCostsSummaryResponseSchema,
) {}
export class PlatformAiCostsBreakdownResponseDto extends createZodDto(
  PlatformAiCostsBreakdownResponseSchema,
) {}
export class AiModelPriceQueryDto extends createZodDto(AiModelPriceQuerySchema) {}
export class AiModelPriceHistoryQueryDto extends createZodDto(AiModelPriceHistoryQuerySchema) {}
export class AiModelPriceResponseDto extends createZodDto(AiModelPriceResponseSchema) {}
export class AiModelPriceListResponseDto extends createZodDto(AiModelPriceListResponseSchema) {}
export class AiModelPriceHistoryResponseDto extends createZodDto(
  AiModelPriceHistoryResponseSchema,
) {}
export class CreateAiModelPriceDto extends createZodDto(CreateAiModelPriceSchema) {}
export class AiModelPriceSyncResponseDto extends createZodDto(AiModelPriceSyncResponseSchema) {}
export class AiUsageEventQueryDto extends createZodDto(AiUsageEventQuerySchema) {}
export class AiUsageEventListResponseDto extends createZodDto(AiUsageEventListResponseSchema) {}
