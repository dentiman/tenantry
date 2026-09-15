import type { z } from 'zod';
import type {
  UpdateAccountProfileSchema,
  ChangeOwnPasswordSchema,
  AuthSessionResponseSchema,
  EmailChangeRequestSchema,
  EmailChangeConfirmSchema,
} from './account.schema';

export type UpdateAccountProfile = z.infer<typeof UpdateAccountProfileSchema>;
export type ChangeOwnPassword = z.infer<typeof ChangeOwnPasswordSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type EmailChangeRequest = z.infer<typeof EmailChangeRequestSchema>;
export type EmailChangeConfirm = z.infer<typeof EmailChangeConfirmSchema>;
