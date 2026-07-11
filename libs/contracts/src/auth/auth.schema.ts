import { z } from 'zod';
import { UserResponseSchema } from '../user/user.schema';

// Нормалізація перед валідацією: у Zod 4 перевірка формату йде до transform-ів
const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

export const RegisterSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(8).max(128),
  name: z.string().nullable().optional(),
});

export const LoginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1),
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
