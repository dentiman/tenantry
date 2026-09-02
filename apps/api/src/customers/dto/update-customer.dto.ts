import { createZodDto } from 'nestjs-zod';
import { UpdateCustomerSchema } from '@saas-skeleton/contracts';

export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
