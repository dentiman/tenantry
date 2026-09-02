import { createZodDto } from 'nestjs-zod';
import { SetCustomerStatusSchema } from '@saas-skeleton/contracts';

export class SetCustomerStatusDto extends createZodDto(SetCustomerStatusSchema) {}
