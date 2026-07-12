import { z } from 'zod';
import { PaginationQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

/**
 * Локаль для server-rendered тексту (email у worker) — окрема закрита множина від
 * SUPPORTED_LOCALES у libs/i18n (contracts свідомо залежить лише від zod). I18N-4:
 * нову мову додавати в ОБИДВА місця.
 */
export const UserLocaleSchema = z.enum(['en']);

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  role: z.enum(['ADMIN', 'USER']),
  isActive: z.boolean(),
  locale: UserLocaleSchema,
  // Wire-формат API: дати передаються як ISO-рядки
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateUserSchema = z.object({
  // Нормалізація перед валідацією: у Zod 4 перевірка формату йде до transform-ів
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'USER']).default('USER').optional(),
  locale: UserLocaleSchema.default('en').optional(),
  // Рішення користувача: адмін завжди задає початковий пароль (межі — як у register)
  password: z.string().min(8).max(128),
});

// Зміна пароля — окремий security-флоу, не через users PATCH
export const UpdateUserSchema = CreateUserSchema.omit({ password: true }).partial();

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
