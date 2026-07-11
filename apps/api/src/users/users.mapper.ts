import type { User as PrismaUser } from '@saas-skeleton/database';
import type { UserResponse } from '@saas-skeleton/contracts';

export function toUserResponse(user: PrismaUser): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
