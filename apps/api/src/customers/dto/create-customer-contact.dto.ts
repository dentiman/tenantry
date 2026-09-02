import { createZodDto } from 'nestjs-zod';
import { CreateCustomerContactSchema } from '@saas-skeleton/contracts';

export class CreateCustomerContactDto extends createZodDto(CreateCustomerContactSchema) {}
