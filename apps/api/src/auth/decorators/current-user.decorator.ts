import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** MT-1: tenant юзера; кладеться при видачі З РЯДКА БД, звіряється guard-ом */
  tenantId: string;
  /**
   * AUTH-1: сесія-пристрій, що видала цей токен. Саме завдяки йому «завершити
   * сесію» вміє порвати socket рівно того пристрою, а список пристроїв — показати
   * «це поточний». Стабільний: ротація refresh-токена його не міняє.
   */
  sid: string;
  /** Id самого токена — під майбутній denylist відкликаних access-токенів */
  jti: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    return data ? request.user[data] : request.user;
  },
);
