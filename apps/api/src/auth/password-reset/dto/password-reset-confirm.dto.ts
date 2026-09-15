import { createZodDto } from 'nestjs-zod';
import { PasswordResetConfirmSchema } from '@saas-skeleton/contracts';

export class PasswordResetConfirmDto extends createZodDto(PasswordResetConfirmSchema) {}
