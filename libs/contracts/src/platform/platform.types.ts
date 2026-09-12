import type { z } from 'zod';
import type {
  PlatformLoginSchema,
  PlatformUserResponseSchema,
  PlatformAuthResponseSchema,
  TenantResponseSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantQuerySchema,
  TenantListResponseSchema,
} from './platform.schema';

export type PlatformLogin = z.infer<typeof PlatformLoginSchema>;
export type PlatformUserResponse = z.infer<typeof PlatformUserResponseSchema>;
export type PlatformAuthResponse = z.infer<typeof PlatformAuthResponseSchema>;
export type TenantResponse = z.infer<typeof TenantResponseSchema>;
export type CreateTenant = z.infer<typeof CreateTenantSchema>;
export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;
export type TenantQuery = z.infer<typeof TenantQuerySchema>;
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;
