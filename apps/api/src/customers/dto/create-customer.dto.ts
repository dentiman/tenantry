import { createZodDto } from 'nestjs-zod';
import { CreateCustomerSchema } from '@saas-skeleton/contracts';

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
