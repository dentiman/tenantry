import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { LOG_CONTEXT } from '@saas-skeleton/shared/logging';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { PlatformJwtPayload } from '../decorators/current-operator.decorator';

/**
 * Guard control plane. JwtService тут сконфігуровано ОКРЕМИМ секретом
 * (PLATFORM_JWT_SECRET) — токен tenant-api фізично не пройде verify, і навпаки.
 * Це найдешевший security boundary між plane-ами (§1 multi-tenancy-plan.md).
 */
@Injectable()
export class PlatformJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { operator?: PlatformJwtPayload }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      request.operator = await this.jwtService.verifyAsync<PlatformJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // `user.id` (оператор) у кожен лог-запис запиту — mixin логера
    this.cls.set(LOG_CONTEXT.userId, request.operator.sub);

    return true;
  }
}
