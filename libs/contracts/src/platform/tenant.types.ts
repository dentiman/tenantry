import type { z } from 'zod';
import type {
  TenantResponseSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantQuerySchema,
  TenantListResponseSchema,
} from './tenant.schema';

export type TenantResponse = z.infer<typeof TenantResponseSchema>;
export type CreateTenant = z.infer<typeof CreateTenantSchema>;
export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;
export type TenantQuery = z.infer<typeof TenantQuerySchema>;
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;
