import { z } from 'zod';
import { paginatedResponseSchema } from '../pagination/pagination.schema';
import {
  SetUserPasswordSchema,
  SetUserStatusSchema,
  UserQuerySchema,
  UserSchema,
} from '../user/user.schema';

// Control plane: керування юзерами tenant-а (аварійний доступ — забутий пароль єдиного
// адміна тощо). Свідомо УРІЗАНА проєкція tenant-ового UserSchema: без телефону, аватара,
// зони й локалі — оператору платформи вони не потрібні, а аватар вимагав би storage.

export const TenantUserResponseSchema = UserSchema.pick({
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
});

export const TenantUserQuerySchema = UserQuerySchema;

/** Ті самі межі, що в tenant-плані: пароль — це пароль tenant-користувача */
export const SetTenantUserPasswordSchema = SetUserPasswordSchema;
export const SetTenantUserStatusSchema = SetUserStatusSchema;

export const TenantUserListResponseSchema = paginatedResponseSchema(TenantUserResponseSchema);

/** Скільки сесій вибито — для підтвердження в UI */
export const TenantUserSessionsRevokedResponseSchema = z.object({
  revokedCount: z.number().int().nonnegative(),
});
