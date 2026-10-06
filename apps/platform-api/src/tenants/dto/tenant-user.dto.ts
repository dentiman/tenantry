import { createZodDto } from 'nestjs-zod';
import {
  SetTenantUserPasswordSchema,
  SetTenantUserStatusSchema,
  TenantUserListResponseSchema,
  TenantUserQuerySchema,
  TenantUserResponseSchema,
  TenantUserSessionsRevokedResponseSchema,
} from '@saas-skeleton/contracts/platform';

export class TenantUserQueryDto extends createZodDto(TenantUserQuerySchema) {}
export class TenantUserResponseDto extends createZodDto(TenantUserResponseSchema) {}
export class TenantUserListResponseDto extends createZodDto(TenantUserListResponseSchema) {}
export class TenantUserSessionsRevokedResponseDto extends createZodDto(
  TenantUserSessionsRevokedResponseSchema,
) {}
export class SetTenantUserPasswordDto extends createZodDto(SetTenantUserPasswordSchema) {}
export class SetTenantUserStatusDto extends createZodDto(SetTenantUserStatusSchema) {}
