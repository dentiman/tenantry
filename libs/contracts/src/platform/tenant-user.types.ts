import type { z } from 'zod';
import type {
  SetTenantUserPasswordSchema,
  SetTenantUserStatusSchema,
  TenantUserListResponseSchema,
  TenantUserQuerySchema,
  TenantUserResponseSchema,
  TenantUserSessionsRevokedResponseSchema,
} from './tenant-user.schema';

export type TenantUserResponse = z.infer<typeof TenantUserResponseSchema>;
export type TenantUserQuery = z.infer<typeof TenantUserQuerySchema>;
export type TenantUserListResponse = z.infer<typeof TenantUserListResponseSchema>;
export type TenantUserSessionsRevokedResponse = z.infer<
  typeof TenantUserSessionsRevokedResponseSchema
>;
export type SetTenantUserPassword = z.infer<typeof SetTenantUserPasswordSchema>;
export type SetTenantUserStatus = z.infer<typeof SetTenantUserStatusSchema>;
