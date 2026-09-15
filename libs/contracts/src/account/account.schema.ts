import { z } from 'zod';
import { CreateUserSchema, PasswordSchema, UserLocaleSchema } from '../user/user.schema';

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Self-service редагування власного профілю. Свідомо ПІДМНОЖИНА UpdateUserSchema,
 * а не він сам: `role` і `isActive` тут відсутні як поняття — юзер не підвищує собі
 * роль і не вмикає собі доступ. `email` теж немає: його зміна потребує підтвердження
 * на нову адресу (окремий флоу, поза V1), тому в UI поле read-only.
 *
 * Виводиться з CreateUserSchema тим самим прийомом, що UpdateUserSchema — щоб правила
 * нормалізації телефону/локалі жили в ОДНОМУ місці.
 */
export const UpdateAccountProfileSchema = CreateUserSchema.pick({
  name: true,
  phone: true,
  phoneCountry: true,
  locale: true,
  // Таймзона — атрибут ПРОФІЛЮ, поруч із локаллю: обидві їдуть за людиною, якщо
  // вона змінить компанію. Окремої особистої секції «Calendar» під одне поле не
  // заводимо — це був би екран з одним селектом (уточнення до docs/calendar.md §9.5)
  timeZone: true,
})
  .partial()
  .extend({
    // Той самий контракт, що в UpdateUserSchema: файл має бути READY і зображенням
    avatarFileId: z.uuid().nullable().optional(),
    // Без `.default('en')`: `.partial()` дефолти не знімає, і зміна лише імені
    // скидала б локаль на англійську (docs/calendar.md §18.17)
    locale: UserLocaleSchema.optional(),
  });

/**
 * Зміна власного пароля. На відміну від адмінського SetUserPasswordSchema тут є
 * `currentPassword` — доказ, що за клавіатурою той самий власник сесії, а не той,
 * хто підсів за незаблокований ноутбук.
 *
 * `currentPassword` — навмисно `min(1)`, а не PasswordSchema: старий пароль міг бути
 * заведений до нинішніх меж, і валідація ФОРМИ старого пароля не має сенсу — його
 * або приймає argon2, або ні.
 */
export const ChangeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
});

/**
 * Рядок списку «мої пристрої» (AUTH-1). З появою `auth_sessions` сесія нарешті стала
 * сутністю з тривалою ідентичністю (`id` переживає ротацію), тож її можна показати
 * і вибірково завершити — до цього існувало тільки «все або нічого».
 *
 * Чого тут НЕМАЄ і не буде: `tokenHash`/`prevTokenHash` (секрет), `revokedAt` і
 * `revokedReason` (список показує лише живі — мертва сесія це не рядок зі статусом,
 * а відсутність рядка). Мапер явний, тому додати їх спреду неможливо.
 */
export const AuthSessionResponseSchema = z.object({
  id: z.uuid(),
  /** «Chrome on macOS» — щоб людина впізнала свій ноутбук; null, якщо UA не було */
  deviceLabel: z.string().nullable(),
  /** Сирий UA поруч із міткою: коли двох «Chrome on macOS» треба якось розрізнити */
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  /** Та сама сесія, з якої прийшов запит (`id === JWT.sid`) — її не можна сплутати */
  isCurrent: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
});

/**
 * AUTH-3: зміна власного email — доказ володіння паролем + підтвердження на НОВУ
 * адресу (не на стару: інакше зловмисник, що вже захопив стару поштову скриньку,
 * міняв би email на свою без жодного підтвердження).
 */
export const EmailChangeRequestSchema = z.object({
  newEmail: normalizedEmail,
  currentPassword: z.string().min(1),
});

/** Публічний — лист відкривають на іншому пристрої; контекст тенанта з префікса токена */
export const EmailChangeConfirmSchema = z.object({
  token: z.string().min(1),
});
