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

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const AuthResponseSchema = z.object({
  user: UserResponseSchema,
  tokens: AuthTokensSchema,
});

export const MeResponseSchema = UserResponseSchema;
