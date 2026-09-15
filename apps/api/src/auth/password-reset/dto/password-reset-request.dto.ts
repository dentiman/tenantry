import { createZodDto } from 'nestjs-zod';
import { PasswordResetRequestSchema } from '@saas-skeleton/contracts';

export class PasswordResetRequestDto extends createZodDto(PasswordResetRequestSchema) {}
