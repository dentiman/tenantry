import { createZodDto } from 'nestjs-zod';
import { AuthSessionResponseSchema } from '@saas-skeleton/contracts';

export class AuthSessionResponseDto extends createZodDto(AuthSessionResponseSchema) {}
