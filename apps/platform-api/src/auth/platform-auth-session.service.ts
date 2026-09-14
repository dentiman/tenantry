import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemPrismaService } from '@saas-skeleton/database';
import type { PlatformAuthSession, PlatformUser } from '@saas-skeleton/database';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Сесія-пристрій control plane (AUTH-2, план §3.4). **Чесна копія**
 * `apps/api/src/auth/auth-session.service.ts`, а не спільне ядро в `libs/shared`:
 * інша Prisma-модель (`PlatformAuthSession`, без `tenantId`/RLS), інший формат
 * токена (`sid:secret`, без tenant-префікса — операторський план тенантів не має),
 * і третього споживача механіки в проєкті немає (конституція VIII, план §«Відкрите»).
 *
 * Свідомо БЕЗ activities/notifications: `ActivitiesModule`/`NotificationsModule`
 * (`libs/shared`) стоять на tenant-контексті (CLS, `withTenantTx`), якого в
 * control plane немає й не буде (§6 плану мультитенантності). Операторів мало,
 * і список пристроїв поза скоупом (contracts/http-api.md § «дзеркало»).
 */

const REUSE_WINDOW_MS = 60_000;
const SHA256_PREFIX = 'sha256:';
const DEFAULT_IDLE_DAYS = 7;
const DEFAULT_ABSOLUTE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlatformSessionRevokeReason = 'logout' | 'rotation_reuse' | 'secret_mismatch';

export interface CreateSessionInput {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  session: PlatformAuthSession;
  /** Сирий `sid:secret` — БЕЗ tenant-префікса (§3.4 плану) */
  refreshToken: string;
}

export interface ConsumedSession extends IssuedSession {
  user: PlatformUser;
}

interface ParsedToken {
  sid: string;
  secret: string;
}

@Injectable()
export class PlatformAuthSessionService {
  private readonly logger = new Logger(PlatformAuthSessionService.name);

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(input: CreateSessionInput): Promise<IssuedSession> {
    const secret = randomBytes(32).toString('hex');
    const now = new Date();

    const session = await this.prisma.platformAuthSession.create({
      data: {
        userId: input.userId,
        tokenHash: sha256Hash(secret),
        idleExpiresAt: new Date(now.getTime() + this.idleDays * DAY_MS),
        absoluteExpiresAt: new Date(now.getTime() + this.absoluteDays * DAY_MS),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    return { session, refreshToken: buildRefreshToken(session.id, secret) };
  }

  /** Той самий порядок перевірок, що в tenant-плані (contracts/http-api.md), без кроків 2/4/8/9 */
  async verifyAndConsume(rawToken: string): Promise<ConsumedSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      this.logger.warn('Platform refresh failed - malformed token');
      throw new UnauthorizedException('Invalid refresh token');
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await this.tryConsume(parsed);
      if (outcome) {
        return outcome;
      }
    }

    this.logger.warn(
      { event: 'auth_refresh_failed', reason: 'rotation_contention', sid: parsed.sid },
      'Platform refresh lost the rotation race twice',
    );
    throw new UnauthorizedException('Invalid refresh token');
  }

  private async tryConsume(parsed: ParsedToken): Promise<ConsumedSession | null> {
    const session = await this.prisma.platformAuthSession.findUnique({
      where: { id: parsed.sid },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!isAlive(session)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (verifyHash(session.tokenHash, parsed.secret)) {
      return this.rotate(session, true);
    }

    if (session.prevTokenHash && verifyHash(session.prevTokenHash, parsed.secret)) {
      if (isWithinReuseWindow(session)) {
        return this.rotate(session, false);
      }
      await this.revoke(session.id, 'rotation_reuse');
      this.logger.error(
        { event: 'auth_refresh_reuse_detected', sid: session.id, userId: session.userId },
        'Platform refresh token reuse detected outside the rotation window',
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.revoke(session.id, 'secret_mismatch');
    this.logger.warn(
      { event: 'auth_refresh_secret_mismatch', sid: session.id },
      'Platform refresh failed - unknown secret, session revoked',
    );
    throw new UnauthorizedException('Invalid refresh token');
  }

  private async rotate(
    session: PlatformAuthSession,
    bumpGeneration: boolean,
  ): Promise<ConsumedSession | null> {
    const secret = randomBytes(32).toString('hex');
    const now = new Date();

    const { count } = await this.prisma.platformAuthSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: {
        tokenHash: sha256Hash(secret),
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + this.idleDays * DAY_MS),
        ...(bumpGeneration
          ? { prevTokenHash: session.tokenHash, prevRotatedAt: now, generation: { increment: 1 } }
          : {}),
      },
    });

    if (count === 0) {
      return null;
    }

    const updated = await this.prisma.platformAuthSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { user: true },
    });

    return {
      session: updated,
      user: updated.user,
      refreshToken: buildRefreshToken(updated.id, secret),
    };
  }

  async revoke(sid: string, reason: PlatformSessionRevokeReason): Promise<number> {
    const { count } = await this.prisma.platformAuthSession.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Здача власного токена на виході; мовчазно ідемпотентний, як у tenant-плані */
  async revokeByToken(rawToken: string): Promise<void> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      return;
    }
    const session = await this.prisma.platformAuthSession.findUnique({
      where: { id: parsed.sid },
    });
    if (!session || session.revokedAt) {
      return;
    }
    const matches =
      verifyHash(session.tokenHash, parsed.secret) ||
      (session.prevTokenHash !== null && verifyHash(session.prevTokenHash, parsed.secret));
    if (!matches) {
      return;
    }
    await this.revoke(session.id, 'logout');
  }

  private get idleDays(): number {
    return Number(this.config.get<string>('AUTH_SESSION_IDLE_DAYS') ?? DEFAULT_IDLE_DAYS);
  }

  private get absoluteDays(): number {
    return Number(this.config.get<string>('AUTH_SESSION_ABSOLUTE_DAYS') ?? DEFAULT_ABSOLUTE_DAYS);
  }
}

function buildRefreshToken(sid: string, secret: string): string {
  return `${sid}:${secret}`;
}

function parseRefreshToken(raw: string): ParsedToken | null {
  const [sid, secret] = raw.split(':');
  if (!sid || !secret) {
    return null;
  }
  return { sid, secret };
}

function sha256Hash(secret: string): string {
  return SHA256_PREFIX + createHash('sha256').update(secret).digest('hex');
}

/**
 * Синхронна, на відміну від tenant-плану: control plane не переносив старих
 * `argon2:`-хешів (refresh-механіки в MVP MT-3 не було), тому `argon2.verify`
 * тут просто нема — весь протокол sha256 (§ коментар `AuthSessionService`).
 */
function verifyHash(stored: string, secret: string): boolean {
  if (!stored.startsWith(SHA256_PREFIX)) {
    return false;
  }
  const expected = Buffer.from(stored.slice(SHA256_PREFIX.length), 'hex');
  const actual = createHash('sha256').update(secret).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAlive(session: PlatformAuthSession): boolean {
  const now = Date.now();
  return (
    session.revokedAt === null &&
    session.idleExpiresAt.getTime() > now &&
    session.absoluteExpiresAt.getTime() > now
  );
}

function isWithinReuseWindow(session: PlatformAuthSession): boolean {
  return (
    session.prevRotatedAt !== null &&
    Date.now() - session.prevRotatedAt.getTime() <= REUSE_WINDOW_MS
  );
}
