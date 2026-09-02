import { createZodDto } from 'nestjs-zod';
import {
  CustomerDetailResponseSchema,
  CustomerListResponseSchema,
  CustomerContactResponseSchema,
  CustomerResponseSchema,
} from '@saas-skeleton/contracts';

export class CustomerResponseDto extends createZodDto(CustomerResponseSchema) {}
export class CustomerDetailResponseDto extends createZodDto(CustomerDetailResponseSchema) {}
export class CustomerListResponseDto extends createZodDto(CustomerListResponseSchema) {}
export class CustomerContactResponseDto extends createZodDto(CustomerContactResponseSchema) {}
