import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from './decorators/current-user.decorator';

/**
 * Payload + реєстровані claim-и, які дописує сам jsonwebtoken. `exp` навмисно
 * НЕ в `JwtPayload`: HTTP-шару він не потрібен (кожен запит перевіряється наново),
 * а `@CurrentUser('...')` мусить лишитись типізованим рядками домену. Socket —
 * інша історія: зʼєднання живе годинами, і гейтвей будує на `exp` цикл
 * auth.expiring.v1 → auth.update.v1.
 */
export interface VerifiedAccessToken extends JwtPayload {
  exp?: number;
  iat?: number;
}

/**
 * ЄДИНЕ місце перевірки access-токена (RT-1). Споживачів двоє і вони в різних
 * транспортах: `JwtAuthGuard` (HTTP) і socket-middleware гейтвею. Правила
 * (секрет, алгоритм, маскування причини) мусять збігатися — інакже колись
 * зʼявиться токен, який HTTP відхиляє, а WebSocket приймає.
 *
 * Причину відмови навмисно НЕ деталізуємо: «протух» і «підроблений» дають той
 * самий 401 — оракула для перебору не існує.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwtService: JwtService) {}

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      return await this.jwtService.verifyAsync<VerifiedAccessToken>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
