import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService, TenantContextService } from '@saas-skeleton/database';
import type { User as PrismaUser } from '@saas-skeleton/database';
import type { Login, AuthTokens } from '@saas-skeleton/contracts';

import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

// MT-1: self-serve реєстрації немає (рішення 2026-07-16) — юзерів створює tenant-адмін
// (users-модуль), тенантів — platform-api (MT-3). Тому auth = тільки login/refresh/me.

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // Auth — легальне місце для tenantId (§0 плану): видача JWT і refresh-резолюція
    private readonly tenantContext: TenantContextService,
  ) {}

  async login(data: Login): Promise<{ user: PrismaUser; tokens: AuthTokens }> {
    this.logger.log(`Login attempt for email: ${data.email}`);

    // Пошук у ВЖЕ резолвленому tenant-і (TenantResolutionMiddleware → CLS → RLS з MT-2);
    // явного where по tenantId немає — скоупить база
    const user = await this.prisma.user.findFirst({
      where: { email: data.email },
      include: { tenant: true },
    });

    if (!user?.passwordHash) {
      this.logLoginFailure(data, 'user_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, data.password);
    if (!isPasswordValid) {
      this.logLoginFailure(data, 'invalid_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      this.logLoginFailure(data, 'user_inactive');
      throw new UnauthorizedException('Account is deactivated');
    }

    // MT-1: suspend тенанта відмовляє вхід усім його юзерам; той самий 401 без деталізації
    if (!user.tenant.isActive) {
      this.logLoginFailure(data, 'tenant_suspended');
      throw new UnauthorizedException('Account is deactivated');
    }

    this.logger.log(`User logged in successfully: ${user.email} (ID: ${user.id})`);

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  /**
   * AUTH-0 (FR-006): невдалий вхід — ТІЛЬКИ технічний лог зі стабільним тегом під алерт,
   * у журнал бізнес-подій не пишеться (перебір засмітив би фід). `requestId` і ip
   * додає контекстний логер pino-http (прив'язка запиту), тут їх дублювати не треба.
   */
  private logLoginFailure(data: Login, reason: string): void {
    this.logger.warn(
      { event: 'auth_login_failed', reason, email: data.email, tenant: data.tenant ?? null },
      `Login failed (${reason}) for ${data.email}`,
    );
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    // MT-1: формат tenantId:tokenId:secret — тенант резолвиться із самого токена
    // (на /auth/refresh немає ні JWT, ні slug-а; для фронта рядок opaque)
    const [tenantId, tokenId, secret] = refreshToken.split(':');
    if (!tenantId || !tokenId || !secret) {
      this.logger.warn('Token refresh failed - invalid token format');
      throw new UnauthorizedException('Invalid refresh token format');
    }

    // Перезаписуємо контекст middleware-а значенням із токена: далі всі запити
    // (пошук токена, ротація, видача) йдуть у tenant-і токена, і RLS (MT-2) це звірить
    this.tenantContext.set(tenantId);

    this.logger.debug(`Token refresh attempt for tokenId: ${tokenId}`);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
      include: { user: { include: { tenant: true } } },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      if (storedToken) {
        await this.prisma.refreshToken.delete({ where: { id: tokenId } });
        this.logger.warn(`Token refresh failed - expired token deleted: ${tokenId}`);
      } else {
        this.logger.warn(`Token refresh failed - token not found: ${tokenId}`);
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Префікс мусить збігатися з tenant-ом рядка (захист від зшитого токена)
    if (storedToken.tenantId !== tenantId) {
      this.logger.warn(`Token refresh failed - tenant mismatch for token: ${tokenId}`);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isValid = await argon2.verify(storedToken.tokenHash, secret);
    if (!isValid) {
      // Possible token theft — delete all tokens for this user
      await this.prisma.refreshToken.deleteMany({
        where: { userId: storedToken.userId },
      });
      this.logger.error(
        `⚠️ SECURITY: Possible token theft detected! All tokens revoked for user: ${storedToken.user.email} (ID: ${storedToken.userId})`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: delete old token, issue new pair
    await this.prisma.refreshToken.delete({ where: { id: tokenId } });

    if (!storedToken.user.isActive) {
      this.logger.warn(`Token refresh failed - account deactivated: ${storedToken.user.email}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!storedToken.user.tenant.isActive) {
      this.logger.warn(
        `Token refresh failed - tenant suspended: ${storedToken.user.tenant.slug} (${storedToken.user.email})`,
      );
      throw new UnauthorizedException('Account is deactivated');
    }

    this.logger.log(
      `Token refreshed successfully for user: ${storedToken.user.email} (ID: ${storedToken.userId})`,
    );

    return this.issueTokens(storedToken.user);
  }

  /**
   * Здача власного refresh-токена на виході (V1 «рівень 0»). До цього logout був
   * суто клієнтським (`clearSession()` у сторі), і рядок токена лишався живим у БД
   * до `expiresAt` — вийшовши на чужому комп'ютері, юзер лишав там робочу сесію.
   *
   * Мовчазно ідемпотентний: невірний формат, чужий tenant, неіснуючий чи вже
   * зданий токен — усе це 204, а не 4xx. Роут публічний, і будь-яка деталізація
   * зробила б із нього оракул «чи існує такий tokenId».
   *
   * Невірний секрет НЕ вмикає theft-detection (на відміну від /refresh): там
   * пред'явлення чужого токена — спроба ним скористатись, тут — щонайбільше спосіб
   * вибити чужі сесії анонімним запитом.
   */
  async logout(refreshToken: string): Promise<void> {
    const [tenantId, tokenId, secret] = refreshToken.split(':');
    if (!tenantId || !tokenId || !secret) {
      this.logger.debug('Logout ignored - invalid token format');
      return;
    }

    // Як у refresh: контекст беремо з самого токена (JWT на цьому роуті немає)
    this.tenantContext.set(tenantId);

    const storedToken = await this.prisma.refreshToken.findUnique({ where: { id: tokenId } });
    if (storedToken?.tenantId !== tenantId) {
      this.logger.debug(`Logout ignored - token not found: ${tokenId}`);
      return;
    }

    if (!(await argon2.verify(storedToken.tokenHash, secret))) {
      this.logger.warn(`Logout ignored - secret mismatch for token: ${tokenId}`);
      return;
    }

    await this.prisma.refreshToken.delete({ where: { id: tokenId } });
    this.logger.log(`Refresh session revoked on logout (user: ${storedToken.userId})`);
  }

  async getMe(userId: string): Promise<PrismaUser> {
    this.logger.debug(`Fetching profile for userId: ${userId}`);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`Profile fetch failed - user not found: ${userId}`);
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  /**
   * Видача пари токенів. Публічний, бо потрібен не тільки login/refresh: після
   * зміни власного пароля і після «вийти звідусіль» усі refresh-рядки юзера
   * видаляються, і поточному пристрою треба одразу повернути свіжу пару — інакше
   * дія, яку людина зробила свідомо, викидала б її саму на /login.
   */
  async issueTokens(user: PrismaUser): Promise<AuthTokens> {
    // tenantId — З РЯДКА ЮЗЕРА в БД, ніколи з запиту (§ «Джерело tenantId» плану)
    const payload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
    const accessToken = await this.jwtService.signAsync(payload);

    // Generate refresh token as tenantId:tokenId:secret
    const tokenRecord = await this.prisma.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: '', // placeholder, updated below
        expiresAt: new Date(
          Date.now() +
            this.configService.get<number>('JWT_REFRESH_EXPIRES_DAYS', 7) * 24 * 60 * 60 * 1000,
        ),
      },
    });

    const secret = randomBytes(32).toString('hex');
    const secretHash = await argon2.hash(secret);

    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { tokenHash: secretHash },
    });

    this.logger.debug(
      `Generated new token pair for user: ${user.email} (tokenId: ${tokenRecord.id})`,
    );

    const refreshToken = `${user.tenantId}:${tokenRecord.id}:${secret}`;
    return { accessToken, refreshToken };
  }
}
