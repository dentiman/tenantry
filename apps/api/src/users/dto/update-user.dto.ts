import { createZodDto } from 'nestjs-zod';
import { UpdateUserSchema } from '@saas-skeleton/contracts';

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
