import type { PlatformUser } from '@saas-skeleton/database';
import type {
  PlatformAuthResponse,
  PlatformAuthTokens,
  PlatformUserResponse,
} from '@saas-skeleton/contracts/platform';
import type { IssuedPlatformTokens } from './platform-auth.service';

export function toPlatformUserResponse(user: PlatformUser): PlatformUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

// AUTH-2: refresh-токен їде в httpOnly cookie — мапери кладуть лише accessToken
export function toPlatformAuthResponse(
  user: PlatformUser,
  tokens: IssuedPlatformTokens,
): PlatformAuthResponse {
  return { user: toPlatformUserResponse(user), accessToken: tokens.accessToken };
}

export function toPlatformAuthTokensResponse(tokens: IssuedPlatformTokens): PlatformAuthTokens {
  return { accessToken: tokens.accessToken };
}
