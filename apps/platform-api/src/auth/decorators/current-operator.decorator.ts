import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** JWT control plane: БЕЗ tenantId — оператор працює над усіма тенантами */
export interface PlatformJwtPayload {
  sub: string;
  email: string;
}

export const CurrentOperator = createParamDecorator(
  (
    data: keyof PlatformJwtPayload | undefined,
    ctx: ExecutionContext,
  ): PlatformJwtPayload | string => {
    const request = ctx.switchToHttp().getRequest<Request & { operator: PlatformJwtPayload }>();
    return data ? request.operator[data] : request.operator;
  },
);
