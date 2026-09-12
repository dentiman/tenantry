import { createZodDto } from 'nestjs-zod';
import {
  CreateTenantSchema,
  TenantListResponseSchema,
  TenantQuerySchema,
  TenantResponseSchema,
  UpdateTenantSchema,
} from '@saas-skeleton/contracts/platform';

export class CreateTenantDto extends createZodDto(CreateTenantSchema) {}
export class UpdateTenantDto extends createZodDto(UpdateTenantSchema) {}
export class TenantQueryDto extends createZodDto(TenantQuerySchema) {}
export class TenantResponseDto extends createZodDto(TenantResponseSchema) {}
export class TenantListResponseDto extends createZodDto(TenantListResponseSchema) {}
