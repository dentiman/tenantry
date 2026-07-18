import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { PlatformUser } from '@saas-skeleton/database';
import type { PlatformLogin } from '@saas-skeleton/contracts/platform';
import * as argon2 from 'argon2';

/**
 * Auth control plane — МІНІМАЛЬНИЙ свідомо (MVP MT-3): login → access JWT (60m),
 * refresh-механіки немає (операторів мало, перелогін прийнятний; додається за потреби
 * за патерном tenant-api). Identity — platform_users, НЕ tenant-юзери.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(data: PlatformLogin): Promise<{ user: PlatformUser; accessToken: string }> {
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

    const accessToken = await this.jwtService.signAsync({ sub: user.id, email: user.email });
    this.logger.log(`Platform operator logged in: ${user.email}`);
    return { user, accessToken };
  }

  async getMe(operatorId: string): Promise<PlatformUser> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: operatorId } });
    if (!user) {
      throw new UnauthorizedException('Operator not found');
    }
    return user;
  }
}
