import { createZodDto } from 'nestjs-zod';
import { UpdateAccountProfileSchema } from '@saas-skeleton/contracts';

export class UpdateAccountProfileDto extends createZodDto(UpdateAccountProfileSchema) {}
