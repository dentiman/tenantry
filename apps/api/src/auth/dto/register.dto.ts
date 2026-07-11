import { createZodDto } from 'nestjs-zod';
import { RegisterSchema } from '@saas-skeleton/contracts';

export class RegisterDto extends createZodDto(RegisterSchema) {}
