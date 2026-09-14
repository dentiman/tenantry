import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Response } from 'express';

/**
 * Єдина зміна відносно пакета — заголовки відповіді. Для іменованих лімітів пакет
 * пише `Retry-After-login` і `X-RateLimit-*-login`: перше — нестандартне ім'я, яке
 * клієнти й проксі не розуміють, друге — підказка атакуючому, скільки спроб лишилось.
 * Тому пакетні заголовки вимкнені (`setHeaders: false`), а на 429 ставиться
 * стандартний `Retry-After` у секундах.
 *
 * Спільний для обох плейнів (AUTH-2, R-15): tenant-api ставить його ПІСЛЯ
 * `JwtAuthGuard`/`RolesGuard`, platform-api — після guard-а автентифікації
 * оператора. Обидва просто розширюють цей клас.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<Response>();
    response.header('Retry-After', String(Math.max(detail.timeToBlockExpire, 1)));
    await super.throwThrottlingException(context, detail);
  }
}
