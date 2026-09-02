import { createZodDto } from 'nestjs-zod';
import { UpdateCustomerContactSchema } from '@saas-skeleton/contracts';

export class UpdateCustomerContactDto extends createZodDto(UpdateCustomerContactSchema) {}
