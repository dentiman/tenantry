import { type CanActivate, type ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { isChatDevToolsEnabled } from '@saas-skeleton/shared';

/**
 * Інструменти розробки чату існують лише з `CHAT_DEV_TOOLS` (CHAT-2a, spec chat/channels і
 * chat/customer-inbox). Без прапорця відповідь — така сама 404, як для маршруту, якого немає:
 * що він реально існує в коді, назовні не видно. Перевірка в момент запиту, а не під час
 * реєстрації контролера, тому e2e можуть вмикати прапорець у межах одного процесу.
 */
@Injectable()
export class ChatDevToolsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (isChatDevToolsEnabled()) return true;
    const req = context.switchToHttp().getRequest<Request>();
    throw new NotFoundException(`Cannot ${req.method} ${req.originalUrl.split('?')[0] ?? req.url}`);
  }
}
