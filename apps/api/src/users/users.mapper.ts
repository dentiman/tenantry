import type { User as PrismaUser } from '@saas-skeleton/database';
import type { UserResponse } from '@saas-skeleton/contracts';
import type { StorageService } from '@saas-skeleton/shared';
import type { UserWithAvatar } from './users.service';

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
    // Календар: NULL означає «як в організації», а не «не знаємо» — фолбек
    // робить клієнт із settings.calendar.timeZone
    timeZone: user.timeZone,
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

/**
 * Той самий UserResponse, але з живим avatarUrl: presigned GET мініатюри, а доки
 * worker її не зробив — оригіналу. Спільний для /users і /account (обидва віддають
 * юзера з аватаром), тому хелпер тут, а не приватним методом контролера.
 *
 * URL короткоживучий — саме тому auth-роути його НЕ пресайнять: /auth/me клієнт
 * тягне раз на старті сесії, і посилання протухло б у нього в руках.
 */
export async function toUserResponseWithAvatar(
  user: UserWithAvatar,
  storage: StorageService,
): Promise<UserResponse> {
  const avatar = user.avatarFile;
  const avatarUrl =
    avatar?.status === 'READY'
      ? await storage.getDownloadUrl(avatar.thumbnailKey ?? avatar.key)
      : null;
  return toUserResponse(user, avatarUrl);
}
