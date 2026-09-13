import type { z } from 'zod';
import type {
  UpdateAccountProfileSchema,
  ChangeOwnPasswordSchema,
  AuthSessionResponseSchema,
} from './account.schema';

export type UpdateAccountProfile = z.infer<typeof UpdateAccountProfileSchema>;
export type ChangeOwnPassword = z.infer<typeof ChangeOwnPasswordSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
