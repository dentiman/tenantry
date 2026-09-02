import { createZodDto } from 'nestjs-zod';
import { CustomerQuerySchema } from '@saas-skeleton/contracts';

export class CustomerQueryDto extends createZodDto(CustomerQuerySchema) {}
