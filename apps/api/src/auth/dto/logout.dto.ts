import { createZodDto } from 'nestjs-zod';
import { LogoutSchema } from '@saas-skeleton/contracts';

export class LogoutDto extends createZodDto(LogoutSchema) {}
