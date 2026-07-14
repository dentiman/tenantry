import { z } from 'zod';
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

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
  avatarFileId: z.uuid().nullable(),
  // Presigned GET мініатюри аватара (короткий TTL). Віддається в JSON, бо <img src>
  // не вміє слати Authorization-заголовок — авторизація вже зашита в підпис URL
  avatarUrl: z.url().nullable(),
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
export const UpdateUserSchema = CreateUserSchema.omit({ password: true }).partial().extend({
  // Демо-споживач файлової підсистеми: файл має бути READY і бути зображенням (перевіряє сервіс)
  avatarFileId: z.uuid().nullable().optional(),
});

export const UserQuerySchema = listQuerySchema([
  'email',
  'name',
  'role',
  'isActive',
  'createdAt',
]).extend({
  role: z.enum(['ADMIN', 'USER']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const UserResponseSchema = UserSchema;

export const UserListResponseSchema = paginatedResponseSchema(UserResponseSchema);
