import type { z } from 'zod';
import type {
  EntityRefSchema,
  ActivityQuerySchema,
  ActivityResponseSchema,
  ActivityListResponseSchema,
} from './activity.schema';

export type EntityRef = z.infer<typeof EntityRefSchema>;
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;
