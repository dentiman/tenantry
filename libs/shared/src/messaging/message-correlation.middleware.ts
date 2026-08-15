import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MessageContextService } from './message-context.service';

/**
 * Корінь ланцюга для HTTP-запиту. Свідомо ПЕРЕВИКОРИСТОВУЄМО pino req.id, а не
 * генеруємо власний: це той самий id, який юзер бачить у ApiError.requestId і який
 * уже стоїть у кожному лог-записі запиту. Отже, скарга «помилка з requestId X»
 * прямо веде і до HTTP-логів, і до всіх job-ів, які цей запит породив.
 */
@Injectable()
export class MessageCorrelationMiddleware implements NestMiddleware {
  constructor(private readonly messageContext: MessageContextService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // pino-http кладе id на req; тип express його не знає
    const reqId = (req as { id?: string | number }).id;
    if (reqId !== undefined) {
      this.messageContext.setCorrelationId(String(reqId));
    }
    next();
  }
}
