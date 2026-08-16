import { createZodDto } from 'nestjs-zod';
import { SetUserPasswordSchema } from '@saas-skeleton/contracts';

export class SetUserPasswordDto extends createZodDto(SetUserPasswordSchema) {}
