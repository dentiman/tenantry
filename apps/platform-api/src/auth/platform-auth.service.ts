import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { PlatformUser } from '@saas-skeleton/database';
import type { PlatformLogin } from '@saas-skeleton/contracts/platform';
import * as argon2 from 'argon2';
import { PlatformAuthSessionService } from './platform-auth-session.service';

export interface PlatformClientContext {
  ip: string | null;
  userAgent: string | null;
}

/** AUTH-2: суперсет відповіді — контролер бере `refreshToken`/`idleExpiresAt` для cookie */
export interface IssuedPlatformTokens {
  accessToken: string;
  refreshToken: string;
  idleExpiresAt: Date;
}

/**
 * Auth control plane (AUTH-2, дзеркало tenant-плану): access 15 хв + refresh у
 * httpOnly cookie з ротацією через `PlatformAuthSession`. До цього (MVP MT-3) тут
 * був лише access-токен 60 хв без refresh-механіки — операторів мало, перелогін
 * був прийнятним; тепер control plane не слабший за data plane.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly jwtService: JwtService,
    private readonly sessions: PlatformAuthSessionService,
  ) {}

  async login(
    data: PlatformLogin,
    client: PlatformClientContext,
  ): Promise<{ user: PlatformUser; tokens: IssuedPlatformTokens }> {
    this.logger.log(`Platform login attempt: ${data.email}`);

    const user = await this.prisma.platformUser.findUnique({ where: { email: data.email } });
    if (!user || !(await argon2.verify(user.passwordHash, data.password))) {
      this.logger.warn(`Platform login failed: ${data.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      this.logger.warn(`Platform login failed - operator deactivated: ${data.email}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    this.logger.log(`Platform operator logged in: ${user.email}`);
    return { user, tokens: await this.issueTokens(user, client) };
  }

  async refresh(refreshToken: string): Promise<IssuedPlatformTokens> {
    const { user, session, refreshToken: rotated } =
      await this.sessions.verifyAndConsume(refreshToken);

    if (!user.isActive) {
      this.logger.warn(`Platform refresh failed - operator deactivated: ${user.email}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: rotated,
      idleExpiresAt: session.idleExpiresAt,
    };
  }

  /** Публічний і мовчазно ідемпотентний — та сама причина, що в tenant-плані */
  logout(refreshToken: string): Promise<void> {
    return this.sessions.revokeByToken(refreshToken);
  }

  async getMe(operatorId: string): Promise<PlatformUser> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: operatorId } });
    if (!user) {
      throw new UnauthorizedException('Operator not found');
    }
    return user;
  }

  private async issueTokens(
    user: PlatformUser,
    client: PlatformClientContext,
  ): Promise<IssuedPlatformTokens> {
    const issued = await this.sessions.create({
      userId: user.id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: issued.refreshToken,
      idleExpiresAt: issued.session.idleExpiresAt,
    };
  }

  private signAccessToken(user: PlatformUser): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, email: user.email });
  }
}
