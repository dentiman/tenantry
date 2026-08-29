import type { User as PrismaUser } from '@saas-skeleton/database';
import type { UserResponse } from '@saas-skeleton/contracts';

/**
 * avatarUrl (presigned GET мініатюри) обчислюється на місці виклику, де завантажений
 * avatarFile — users-контролер. Auth-відповіді його не пресайнять (передають дефолт
 * null): демо-споживач аватара — сторінка /users.
 */
export function toUserResponse(user: PrismaUser, avatarUrl: string | null = null): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    // Prisma зберігає locale як звичайний string; валідність гарантує вхідний Zod-контракт
    locale: user.locale as UserResponse['locale'],
    phone: user.phone,
    phoneCountry: user.phoneCountry,
    avatarFileId: user.avatarFileId,
    avatarUrl,
    // RT-3: пише presence-шар, не доменний код (див. LastSeenWriter)
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
