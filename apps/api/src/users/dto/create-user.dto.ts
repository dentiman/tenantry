import { createZodDto } from 'nestjs-zod';
import { CreateUserSchema } from '@saas-skeleton/contracts';

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
