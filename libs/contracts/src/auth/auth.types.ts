import type { z } from 'zod';
import type {
  LoginSchema,
  RefreshSchema,
  LogoutSchema,
  AuthTokensSchema,
  AuthResponseSchema,
  MeResponseSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
} from './auth.schema';

export type Login = z.infer<typeof LoginSchema>;
export type Refresh = z.infer<typeof RefreshSchema>;
export type Logout = z.infer<typeof LogoutSchema>;
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;
