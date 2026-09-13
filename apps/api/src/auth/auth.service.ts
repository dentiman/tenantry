import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma, User as PrismaUser } from '@saas-skeleton/database';
import { NotificationRecorder, parseUserAgent } from '@saas-skeleton/shared';
import type { Login, AuthTokens } from '@saas-skeleton/contracts';

import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import type { ClientContextData } from '../common/client-context.decorator';
import { AuthSessionService } from './auth-session.service';

// MT-1: self-serve реєстрації немає (рішення 2026-07-16) — юзерів створює tenant-адмін
// (users-модуль), тенантів — platform-api (MT-3). Тому auth = тільки login/refresh/me.

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly tenantTx: TenantTransactions,
    private readonly sessions: AuthSessionService,
    private readonly notifications: NotificationRecorder,
  ) {}

  async login(
    data: Login,
    client: ClientContextData,
  ): Promise<{ user: PrismaUser; tokens: AuthTokens }> {
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

    const tokens = await this.issueTokens(user, client, { notifyNewDevice: true });
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

  /**
   * Ротація сесії. Механіка — в `AuthSessionService`; тут лишається питання
   * identity: чи взагалі має право заходити той, чия сесія ще жива.
   *
   * Порядок саме такий (contracts/http-api.md §«POST /auth/refresh»): спершу
   * сесія, потім акаунт. Деактивованому юзеру однаково прилетить 401, але його
   * токен при цьому вже ротований — тобто вкрадена копія теж стала недійсною.
   */
  async refresh(refreshToken: string, client: ClientContextData): Promise<AuthTokens> {
    const { user, session, refreshToken: rotated } = await this.sessions.verifyAndConsume(
      refreshToken,
      client,
    );

    if (!user.isActive) {
      this.logger.warn(`Token refresh failed - account deactivated: ${user.email}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.tenant.isActive) {
      this.logger.warn(
        `Token refresh failed - tenant suspended: ${user.tenant.slug} (${user.email})`,
      );
      throw new UnauthorizedException('Account is deactivated');
    }

    this.logger.log(`Token refreshed successfully for user: ${user.email} (ID: ${user.id})`);

    return {
      accessToken: await this.signAccessToken(user, session.id),
      refreshToken: rotated,
    };
  }

  /**
   * Вихід: клієнт здає свій refresh-токен, сесія отримує `revoked_reason = 'logout'`.
   *
   * Мовчазно ідемпотентний: невірний формат, чужий tenant, неіснуюча чи вже здана
   * сесія — усе це 204, а не 4xx. Роут публічний, і будь-яка деталізація зробила б
   * із нього оракул «чи існує така сесія».
   */
  logout(refreshToken: string): Promise<void> {
    return this.sessions.revokeByToken(refreshToken);
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
   * Нова сесія + пара токенів. Потрібна не тільки логіну: після зміни власного
   * пароля і після «вийти звідусіль» усі сесії юзера відкликаються (включно з тією,
   * з якої прийшов запит) — без свіжої пари дія, зроблена свідомо, викидала б
   * людину на /login.
   */
  async issueTokens(
    user: PrismaUser,
    client: ClientContextData,
    options: { notifyNewDevice?: boolean } = {},
  ): Promise<AuthTokens> {
    const issued = await this.tenantTx.withTenantTx(async (tx) => {
      // Перевіряємо ДО створення сесії: інакше щойно створений рядок і був би
      // тією «наявною сесією з тим самим пристроєм», і сповіщення не прийшло б ніколи
      const isNewDevice =
        options.notifyNewDevice === true && (await this.isNewDevice(user.id, client));

      const created = await this.sessions.create(tx, { userId: user.id, client });

      if (isNewDevice) {
        await this.notifyNewDevice(tx, user.id, client);
      }
      return created;
    });

    return {
      accessToken: await this.signAccessToken(user, issued.session.id),
      refreshToken: issued.refreshToken,
    };
  }

  private isNewDevice(userId: string, client: ClientContextData): Promise<boolean> {
    return this.sessions
      .hasLiveSessionWithDevice(userId, parseUserAgent(client.userAgent))
      .then((exists) => !exists);
  }

  /**
   * «Вхід із нового пристрою» — сповіщення, а не блокування: система не знає, чи це
   * зловмисник, чи власник купив ноутбук. Знає це тільки людина, тому їй і кажемо.
   *
   * Ключ — `deviceLabel`, тобто груба мітка «Chrome on macOS», а не точний
   * User-Agent: мінорна версія браузера оновлюється сама і не мусить виглядати
   * як новий пристрій — інакше сповіщення знецінилося б за тиждень.
   */
  private notifyNewDevice(
    tx: Prisma.TransactionClient,
    userId: string,
    client: ClientContextData,
  ): Promise<void> {
    return this.notifications.notify(tx, {
      type: 'auth.new_device',
      recipientIds: [userId],
      // Актор — система: людина не «робила» цього сповіщення, вона його отримувач
      actor: { type: 'system' },
      payload: { deviceLabel: parseUserAgent(client.userAgent), ip: client.ip },
    });
  }

  /**
   * `sid` — сесія, з якої виданий токен: саме він дозволяє порвати socket рівно
   * того пристрою, який відкликали, не зачепивши решту вкладок юзера.
   * `jti` — id самого токена, під майбутній denylist (AUTH-4 і далі).
   */
  private signAccessToken(user: PrismaUser, sid: string): Promise<string> {
    // tenantId — З РЯДКА ЮЗЕРА в БД, ніколи з запиту (§ «Джерело tenantId» плану)
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      sid,
      jti: randomUUID(),
    });
  }
}
