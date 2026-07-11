import { createZodDto } from 'nestjs-zod';
import { UserQuerySchema } from '@saas-skeleton/contracts';

export class UserQueryDto extends createZodDto(UserQuerySchema) {}
