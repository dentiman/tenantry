import { createZodDto } from 'nestjs-zod';
import { ExportCustomersSchema } from '@saas-skeleton/contracts';

export class ExportCustomersDto extends createZodDto(ExportCustomersSchema) {}
