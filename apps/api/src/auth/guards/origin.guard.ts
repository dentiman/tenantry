import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { resolveAllowedOrigins } from '../../config/cors.config';

/**
 * Пояс і підтяжки поруч із `SameSite=Lax` (AUTH-2, план §3.1): сучасний браузер уже
 * не шле cookie на cross-site POST, але старі браузери — можуть. `Origin` відсутній
 * (native-клієнти, curl, server-to-server) → пропускаємо; присутній і не в
 * allowlist (той самий список, що HTTP CORS і Socket.IO, `config/cors.config.ts`) →
 * 403. Застосовується лише на `POST /auth/refresh` і `POST /auth/logout` — обидва
 * публічні, тож глобальний CORS-preflight їх не захищає.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (origin === undefined) {
      return true;
    }
    if (!resolveAllowedOrigins().includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    return true;
  }
}
