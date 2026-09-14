import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { resolvePlatformAllowedOrigins } from '../../config/env.schema';

/**
 * Дзеркало `apps/api/src/auth/guards/origin.guard.ts` (AUTH-2). `Origin` відсутній →
 * пропуск; присутній і не в allowlist control plane (`PLATFORM_CORS_ALLOWED_ORIGINS`)
 * → 403. Застосовується лише на `POST /auth/refresh` і `POST /auth/logout`.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (origin === undefined) {
      return true;
    }
    if (!resolvePlatformAllowedOrigins().includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    return true;
  }
}
