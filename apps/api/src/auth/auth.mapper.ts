import type { User as PrismaUser } from '@saas-skeleton/database';
import type { AuthResponse, AuthTokens, MeResponse } from '@saas-skeleton/contracts';
import { toUserResponse } from '../users/users.mapper';
import type { IssuedAuthTokens } from './auth.service';

// AUTH-2: refresh-токен їде в httpOnly cookie, а не в тілі — мапери кладуть
// лише accessToken. `IssuedAuthTokens` (сервісний тип) несе refreshToken/idleExpiresAt
// ЛИШЕ для контролера, щоб виставити cookie; у відповідь вони не потрапляють.
export function toAuthResponse(user: PrismaUser, tokens: IssuedAuthTokens): AuthResponse {
  return {
    user: toUserResponse(user),
    tokens: toAuthTokensResponse(tokens),
  };
}

export function toAuthTokensResponse(tokens: IssuedAuthTokens): AuthTokens {
  return { accessToken: tokens.accessToken };
}

export function toMeResponse(user: PrismaUser): MeResponse {
  return toUserResponse(user);
}
