import { createZodDto } from 'nestjs-zod';
import { LoginSchema } from '@saas-skeleton/contracts';

export class LoginDto extends createZodDto(LoginSchema) {}
