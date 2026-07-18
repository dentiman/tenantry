import { createZodDto } from 'nestjs-zod';
import {
  CreateTenantSchema,
  TenantListResponseSchema,
  TenantResponseSchema,
  UpdateTenantSchema,
} from '@saas-skeleton/contracts/platform';

export class CreateTenantDto extends createZodDto(CreateTenantSchema) {}
export class UpdateTenantDto extends createZodDto(UpdateTenantSchema) {}
export class TenantResponseDto extends createZodDto(TenantResponseSchema) {}
export class TenantListResponseDto extends createZodDto(TenantListResponseSchema) {}
