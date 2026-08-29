import { z } from 'zod';
import { CreateUserSchema, PasswordSchema } from '../user/user.schema';

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
})
  .partial()
  .extend({
    // Той самий контракт, що в UpdateUserSchema: файл має бути READY і зображенням
    avatarFileId: z.uuid().nullable().optional(),
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
