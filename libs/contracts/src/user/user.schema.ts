import { z } from 'zod';
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';
import { CountryCodeSchema, PhoneNumberSchema } from '../phone/phone.schema';

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
  // У response — навмисно М'ЯКО (просто рядок): суворий PhoneNumberSchema тут означав би,
  // що оновлення метаданих libphonenumber може зробити вже збережений номер невалідним
  // і завалити ВІДДАЧУ даних. Сувора перевірка — на вході (Create/Update)
  phone: z.string().nullable(),
  phoneCountry: z.string().nullable(),
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
  // Телефон приходить уже в E.164 — національний формат і маски існують ТІЛЬКИ в UI.
  // phoneCountry опційний: якщо клієнт його не прислав, сервіс виведе країну з номера
  // (пара тримається узгодженою в одному місці — UsersService, а не крос-полевим refine,
  // який зламав би .omit()/.partial() для UpdateUserSchema)
  phone: PhoneNumberSchema.nullable().optional(),
  phoneCountry: CountryCodeSchema.nullable().optional(),
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
