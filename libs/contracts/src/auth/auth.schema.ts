import { z } from 'zod';
import { UserResponseSchema } from '../user/user.schema';

// Нормалізація перед валідацією: у Zod 4 перевірка формату йде до transform-ів
const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

// MT-1: RegisterSchema видалено (рішення 2026-07-16) — self-serve реєстрації немає

export const LoginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1),
  /**
   * MT-3: slug тенанта — недовірена підказка, що лише звужує пошук юзера
   * (доступ дають креденшели; JWT.tenantId завжди з рядка БД).
   * Порожній рядок легальний = «без підказки» (SlugTenantResolver дає env-fallback).
   */
  tenant: z.string().trim().toLowerCase().max(63).optional(),
});

/**
 * AUTH-2: токен їде в httpOnly cookie (`saas_refresh`) — тіло порожнє. Поле лишається
 * як ПЕРЕХІДНИЙ шлях (platform-web і старі вкладки tenant-web ще шлють токен у тілі
 * між AUTH-2 і AUTH-4, план §3.2); читається лише якщо cookie немає. Прибрати після
 * AUTH-4 (§7 плану).
 */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

/**
 * Здача власного refresh-токена на виході. Форма збігається з RefreshSchema, але це
 * ОКРЕМИЙ контракт: /refresh просить нову пару, /logout — знищує наявну, і їхні тіла
 * вільні розійтися (напр. logout колись прийме `allDevices`).
 *
 * Роут публічний: протухлий access-токен не має заважати здати refresh — власність
 * доводить сам секрет усередині токена. AUTH-2: токен спочатку з cookie, тіло —
 * той самий перехідний шлях, що в RefreshSchema.
 */
export const LogoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

/**
 * AUTH-2: сервер більше не кладе `refreshToken` у тіло (він їде в httpOnly cookie) —
 * поле стає опційним, а не видаляється: platform-web ще на старій схемі, і мапери
 * можуть просто не заповнювати його. Прибрати після AUTH-4.
 */
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
});

export const AuthResponseSchema = z.object({
  user: UserResponseSchema,
  tokens: AuthTokensSchema,
});

export const MeResponseSchema = UserResponseSchema;
