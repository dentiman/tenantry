import { createZodDto } from 'nestjs-zod';
import {
  TenantActivityListResponseSchema,
  TenantActivityQuerySchema,
} from '@saas-skeleton/contracts/platform';

export class TenantActivityQueryDto extends createZodDto(TenantActivityQuerySchema) {}
export class TenantActivityListResponseDto extends createZodDto(
  TenantActivityListResponseSchema,
) {}
