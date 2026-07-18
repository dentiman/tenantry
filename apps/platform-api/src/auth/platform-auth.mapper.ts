import type { PlatformUser } from '@saas-skeleton/database';
import type { PlatformAuthResponse, PlatformUserResponse } from '@saas-skeleton/contracts/platform';

export function toPlatformUserResponse(user: PlatformUser): PlatformUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toPlatformAuthResponse(
  user: PlatformUser,
  accessToken: string,
): PlatformAuthResponse {
  return { user: toPlatformUserResponse(user), accessToken };
}
