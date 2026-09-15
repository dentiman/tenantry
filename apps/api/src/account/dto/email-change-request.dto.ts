import { createZodDto } from 'nestjs-zod';
import { EmailChangeRequestSchema } from '@saas-skeleton/contracts';

export class EmailChangeRequestDto extends createZodDto(EmailChangeRequestSchema) {}
