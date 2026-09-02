import type { z } from 'zod';
import type {
  UpdateNumberSeriesSchema,
  SetNextNumberSchema,
  NumberSeriesResponseSchema,
  NumberSeriesListResponseSchema,
} from './numbering.schema';

export type UpdateNumberSeries = z.infer<typeof UpdateNumberSeriesSchema>;
export type SetNextNumber = z.infer<typeof SetNextNumberSchema>;
export type NumberSeriesResponse = z.infer<typeof NumberSeriesResponseSchema>;
export type NumberSeriesListResponse = z.infer<typeof NumberSeriesListResponseSchema>;
