import { z } from 'zod';
import { PaginationQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  role: z.enum(['ADMIN', 'USER']),
  isActive: z.boolean(),
  // Wire-формат API: дати передаються як ISO-рядки
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateUserSchema = z.object({
  // Нормалізація перед валідацією: у Zod 4 перевірка формату йде до transform-ів
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'USER']).default('USER').optional(),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export const UserQuerySchema = PaginationQuerySchema.extend({
  role: z.enum(['ADMIN', 'USER']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const UserResponseSchema = UserSchema;

export const UserListResponseSchema = paginatedResponseSchema(UserResponseSchema);
