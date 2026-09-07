import { z } from 'zod';
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';
import { CountryCodeSchema, PhoneNumberSchema } from '../phone/phone.schema';
import { TimeZoneSchema } from '../time/time.schema';

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
  /**
   * IANA-зона юзера (docs/calendar.md §6.1). `null` — «як в організації»:
   * фолбек на `settings.calendar.timeZone`, а не порожній календар.
   *
   * Окреме поле від `locale` свідомо: локаль задає ФОРМАТ («6 вер. 2026, 14:00»),
   * зона — який саме це момент. Людина в Берліні з англійським інтерфейсом —
   * норма, і без зони її зустріч показувалась би не в той час.
   */
  timeZone: z.string().nullable(),
  // У response — навмисно М'ЯКО (просто рядок): суворий PhoneNumberSchema тут означав би,
  // що оновлення метаданих libphonenumber може зробити вже збережений номер невалідним
  // і завалити ВІДДАЧУ даних. Сувора перевірка — на вході (Create/Update)
  phone: z.string().nullable(),
  phoneCountry: z.string().nullable(),
  avatarFileId: z.uuid().nullable(),
  // Presigned GET мініатюри аватара (короткий TTL). Віддається в JSON, бо <img src>
  // не вміє слати Authorization-заголовок — авторизація вже зашита в підпис URL
  avatarUrl: z.url().nullable(),
  /**
   * RT-3: останній момент, коли юзер точно був підключений до realtime.
   * `null` — не підключався жодного разу (це окремий стан «Never», а не «давно»).
   * Межа фічі: рахуються ТІЛЬКИ socket-зʼєднання, не REST-активність — інакше
   * підпис розійшовся б із крапкою присутності, яка теж socket-based.
   */
  lastSeenAt: z.iso.datetime().nullable(),
  // Wire-формат API: дати передаються як ISO-рядки
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** Межі пароля — одне місце на всі флоу (create, зміна пароля адміном) */
export const PasswordSchema = z.string().min(8).max(128);

export const CreateUserSchema = z.object({
  // Нормалізація перед валідацією: у Zod 4 перевірка формату йде до transform-ів
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'USER']).default('USER').optional(),
  locale: UserLocaleSchema.default('en').optional(),
  /** Зона нового юзера; не передали → успадкує дефолт організації (null у БД) */
  timeZone: TimeZoneSchema.nullable().optional(),
  // Телефон приходить уже в E.164 — національний формат і маски існують ТІЛЬКИ в UI.
  // phoneCountry опційний: якщо клієнт його не прислав, сервіс виведе країну з номера
  // (пара тримається узгодженою в одному місці — UsersService, а не крос-полевим refine,
  // який зламав би .omit()/.partial() для UpdateUserSchema)
  phone: PhoneNumberSchema.nullable().optional(),
  phoneCountry: CountryCodeSchema.nullable().optional(),
  // Рішення користувача: адмін завжди задає початковий пароль (межі — як у register)
  password: PasswordSchema,
});

/**
 * Зміна пароля адміном — окремий security-флоу, свідомо НЕ через users PATCH.
 * Підтвердження пароля тут НЕМАЄ: це UX-перевірка форми (друкарська помилка),
 * серверу другий екземпляр того самого рядка не дає нічого — фронт валідує
 * збіг локально своєю схемою поверх цієї.
 */
export const SetUserPasswordSchema = z.object({
  password: PasswordSchema,
});

/** Увімкнення/вимкнення доступу юзера; окремо від PATCH — бо це подія, а не редагування атрибута */
export const SetUserStatusSchema = z.object({
  isActive: z.boolean(),
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
