import type { z } from 'zod';
import type {
  UserSchema,
  CreateUserSchema,
  UpdateUserSchema,
  UserQuerySchema,
  UserResponseSchema,
  UserListResponseSchema,
  SetUserPasswordSchema,
  SetUserStatusSchema,
} from './user.schema';

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type SetUserPassword = z.infer<typeof SetUserPasswordSchema>;
export type SetUserStatus = z.infer<typeof SetUserStatusSchema>;
export type UserQuery = z.infer<typeof UserQuerySchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
