import { createZodDto } from 'nestjs-zod';
import { UserListResponseSchema, UserResponseSchema } from '@saas-skeleton/contracts';

export class UserResponseDto extends createZodDto(UserResponseSchema) {}
export class UserListResponseDto extends createZodDto(UserListResponseSchema) {}
