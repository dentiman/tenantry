import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Мережевий контекст запиту — усе, що потрібно сесії знати про пристрій.
 *
 * Окремий декоратор, а не читання `req` у сервісі: доменні сервіси express-об'єктів
 * не бачать (їх викликають і з воркера, і з тестів), тому HTTP-специфіка лишається
 * на межі контролера.
 *
 * `req.ip` — уже після `trust proxy` (AUTH-0), тобто реальний клієнт, а не адреса
 * nginx. User-Agent обрізається: заголовок керується клієнтом і в теорії не обмежений.
 */
export interface ClientContextData {
  ip: string | null;
  userAgent: string | null;
}

const MAX_USER_AGENT_LENGTH = 512;

export const ClientContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientContextData => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const userAgent = (request.headers['user-agent'] ?? '').slice(0, MAX_USER_AGENT_LENGTH);
    return {
      ip: request.ip ?? null,
      userAgent: userAgent === '' ? null : userAgent,
    };
  },
);
