import { createZodDto } from 'nestjs-zod';
import { EmailChangeConfirmSchema } from '@saas-skeleton/contracts';

export class EmailChangeConfirmDto extends createZodDto(EmailChangeConfirmSchema) {}
