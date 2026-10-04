import type { z } from 'zod';
import type {
  AiModelPriceHistoryQuerySchema,
  AiModelPriceHistoryResponseSchema,
  AiModelPriceListResponseSchema,
  AiModelPriceQuerySchema,
  AiModelPriceResponseSchema,
  AiModelPriceSyncResponseSchema,
  CreateAiModelPriceSchema,
  PlatformAiCostTotalsSchema,
  PlatformAiCostsBreakdownQuerySchema,
  PlatformAiCostsBreakdownResponseSchema,
  PlatformAiCostsQuerySchema,
  PlatformAiCostsSummaryResponseSchema,
} from './ai-costs.schema';

export type PlatformAiCostsQuery = z.infer<typeof PlatformAiCostsQuerySchema>;
export type PlatformAiCostsBreakdownQuery = z.infer<typeof PlatformAiCostsBreakdownQuerySchema>;
export type PlatformAiCostTotals = z.infer<typeof PlatformAiCostTotalsSchema>;
export type PlatformAiCostsSummaryResponse = z.infer<typeof PlatformAiCostsSummaryResponseSchema>;
export type PlatformAiCostsBreakdownResponse = z.infer<
  typeof PlatformAiCostsBreakdownResponseSchema
>;
export type AiModelPriceResponse = z.infer<typeof AiModelPriceResponseSchema>;
export type AiModelPriceQuery = z.infer<typeof AiModelPriceQuerySchema>;
export type AiModelPriceListResponse = z.infer<typeof AiModelPriceListResponseSchema>;
export type AiModelPriceHistoryQuery = z.infer<typeof AiModelPriceHistoryQuerySchema>;
export type AiModelPriceHistoryResponse = z.infer<typeof AiModelPriceHistoryResponseSchema>;
export type CreateAiModelPrice = z.infer<typeof CreateAiModelPriceSchema>;
export type AiModelPriceSyncResponse = z.infer<typeof AiModelPriceSyncResponseSchema>;
