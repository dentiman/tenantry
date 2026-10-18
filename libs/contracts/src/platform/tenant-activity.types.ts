import type { z } from 'zod';
import type {
  TenantActivityListResponseSchema,
  TenantActivityQuerySchema,
} from './tenant-activity.schema';

export type TenantActivityQuery = z.infer<typeof TenantActivityQuerySchema>;
export type TenantActivityListResponse = z.infer<typeof TenantActivityListResponseSchema>;
