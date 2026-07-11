import type { z } from 'zod';
import type {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  AuthTokensSchema,
  AuthResponseSchema,
  MeResponseSchema,
} from './auth.schema';

export type Register = z.infer<typeof RegisterSchema>;
export type Login = z.infer<typeof LoginSchema>;
export type Refresh = z.infer<typeof RefreshSchema>;
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
