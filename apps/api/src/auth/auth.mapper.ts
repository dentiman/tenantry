import type { User as PrismaUser } from '@saas-skeleton/database';
import type { AuthResponse, AuthTokens, MeResponse } from '@saas-skeleton/contracts';
import { toUserResponse } from '../users/users.mapper';

export function toAuthResponse(user: PrismaUser, tokens: AuthTokens): AuthResponse {
  return {
    user: toUserResponse(user),
    tokens,
  };
}

export function toMeResponse(user: PrismaUser): MeResponse {
  return toUserResponse(user);
}
