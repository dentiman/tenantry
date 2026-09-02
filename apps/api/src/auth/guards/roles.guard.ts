import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@saas-skeleton/database';
import type { Request } from 'express';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Другий глобальний guard, ПІСЛЯ JwtAuthGuard (порядок = порядок реєстрації
 * APP_GUARD): на цьому етапі `request.user` уже є.
 *
 * Хендлер без `@Roles(...)` пропускається — гейт opt-in. Це свідомо: інакше
 * кожен наявний ендпоінт довелося б розмічати одночасно з введенням guard-а,
 * і будь-який пропуск ставав би 403 на робочому флоу.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const role = request.user?.role;
    if (!role || !required.some((candidate) => candidate === role)) {
      // 403, а не 404: ресурс існує і клієнт про нього знає — ховати нічого,
      // на відміну від чужого tenant-а, де приховане саме існування рядка
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
