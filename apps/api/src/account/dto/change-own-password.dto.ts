import { createZodDto } from 'nestjs-zod';
import { ChangeOwnPasswordSchema } from '@saas-skeleton/contracts';

export class ChangeOwnPasswordDto extends createZodDto(ChangeOwnPasswordSchema) {}
