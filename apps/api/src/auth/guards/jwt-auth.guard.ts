import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from '@saas-skeleton/database';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // MT-3: звірка «токен vs резолвлений контекст» — ТІЛЬКИ для авторитетної резолюції
    // (Static N=1 — завжди; slug — коли slug присутній; піддомени MT-4 — завжди).
    // Неавторитетний fallback не конфліктує з токеном: авторитет — підписаний JWT.
    // Після звірки контекст перезаписується tenant-ом токена — далі скоупить він.
    const resolved = this.tenantContext.getTenantId();
    if (
      this.tenantContext.isResolutionAuthoritative() &&
      resolved &&
      payload.tenantId !== resolved
    ) {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    this.tenantContext.set(payload.tenantId);

    request.user = payload;
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
