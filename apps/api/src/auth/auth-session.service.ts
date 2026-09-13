import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { AuthSession, Prisma, Tenant, User } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  NotificationRecorder,
  parseUserAgent,
  type SessionRevokeReason,
} from '@saas-skeleton/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { ClientContextData } from '../common/client-context.decorator';

/**
 * Сесія-пристрій (AUTH-1). Уся робота з `auth_sessions` живе тут — `AuthService`
 * лишається про identity (пароль, JWT), а не про механіку ротації.
 *
 * Ключова зміна проти старих `refresh_tokens`: `id` сесії СТАБІЛЬНИЙ. Раніше
 * ротація робила delete+create, тож «сесія» була рядком, що живе до наступного
 * refresh — показати список пристроїв або вбити один із них було неможливо не
 * через недороблений UI, а тому, що показувати не було чого.
 */

/**
 * Вікно, в якому старий (щойно ротований) секрет ще приймається. НЕ env: це
 * властивість протоколу ротації, а не політики безпеки тенанта.
 *
 * Без нього кожен обірваний на пів-дорозі refresh (втрачена мережа після коміту,
 * але до отримання відповіді) і кожна гонка двох вкладок виглядали б як крадіжка
 * токена — і чесний користувач опинявся б на /login із тривожним листом.
 */
const REUSE_WINDOW_MS = 60_000;

const SHA256_PREFIX = 'sha256:';
const ARGON2_PREFIX = 'argon2:';

const DEFAULT_IDLE_DAYS = 7;
const DEFAULT_ABSOLUTE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionUser = User & { tenant: Tenant };

export interface CreateSessionInput {
  userId: string;
  client: ClientContextData;
}

export interface IssuedSession {
  session: AuthSession;
  /** Сирий `tenantId:sid:secret` — існує РІВНО тут і в відповіді клієнту */
  refreshToken: string;
}

export interface ConsumedSession extends IssuedSession {
  user: SessionUser;
}

interface ParsedToken {
  tenantId: string;
  sid: string;
  secret: string;
}

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Auth — легальне місце для tenantId (§0 плану MT): refresh приходить без JWT,
    // і контекст доводиться підіймати з префікса самого токена
    private readonly tenantContext: TenantContextService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
    private readonly notifications: NotificationRecorder,
  ) {}

  // ------------------------------------------------------------------ видача

  /**
   * Один INSERT. Старий код робив create з `tokenHash: ''` і одразу UPDATE —
   * між ними існувало вікно, в якому в БД лежав рядок із порожнім хешем.
   */
  async create(tx: Prisma.TransactionClient, input: CreateSessionInput): Promise<IssuedSession> {
    const secret = randomBytes(32).toString('hex');
    const now = new Date();

    const session = await tx.authSession.create({
      data: {
        userId: input.userId,
        tokenHash: sha256Hash(secret),
        idleExpiresAt: new Date(now.getTime() + this.idleDays * DAY_MS),
        absoluteExpiresAt: new Date(now.getTime() + this.absoluteDays * DAY_MS),
        ip: input.client.ip,
        userAgent: input.client.userAgent,
        deviceLabel: parseUserAgent(input.client.userAgent),
      },
    });

    return { session, refreshToken: buildRefreshToken(session.tenantId, session.id, secret) };
  }

  // --------------------------------------------------------------- ротація

  /**
   * Порядок перевірок — `contracts/http-api.md` § «POST /auth/refresh».
   * Усі відмови однакові (401 без деталізації): будь-яка різниця у відповіді
   * зробила б із роуту оракул «чи існує така сесія».
   *
   * Перевірку `user.isActive`/`tenant.isActive` навмисно НЕ робимо тут — це
   * питання identity, а не сесії, і лишається в `AuthService.refresh`.
   */
  async verifyAndConsume(rawToken: string, client: ClientContextData): Promise<ConsumedSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      this.logger.warn({ event: 'auth_refresh_failed', reason: 'malformed' }, 'Malformed token');
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Далі все — у тенанті ТОКЕНА: пошук сесії, ротація, читання юзера. RLS (MT-2)
    // цю заяву перевірить — рядка чужого тенанта тут просто не існує
    this.tenantContext.set(parsed.tenantId);

    // Дві спроби, а не цикл: `count === 0` означає, що паралельний запит
    // ротував сесію між нашим SELECT і UPDATE. Повторне читання побачить уже
    // новий стан і піде гілкою prev-секрету; третій раз поспіль цього статися
    // не може без того, щоб клієнт справді не бив у роут нескінченно
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await this.tryConsume(parsed, client);
      if (outcome) {
        return outcome;
      }
    }

    this.logger.warn(
      { event: 'auth_refresh_failed', reason: 'rotation_contention', sid: parsed.sid },
      'Refresh lost the rotation race twice',
    );
    throw new UnauthorizedException('Invalid refresh token');
  }

  /** Одна спроба; `null` = сесію ротував хтось паралельно, треба перечитати */
  private async tryConsume(
    parsed: ParsedToken,
    client: ClientContextData,
  ): Promise<ConsumedSession | null> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: parsed.sid },
      include: { user: { include: { tenant: true } } },
    });

    if (session?.tenantId !== parsed.tenantId) {
      this.logger.warn(
        { event: 'auth_refresh_failed', reason: 'session_not_found', sid: parsed.sid },
        'Refresh failed - session not found',
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!isAlive(session)) {
      this.logger.warn(
        {
          event: 'auth_refresh_failed',
          reason: session.revokedAt ? 'revoked' : 'expired',
          sid: session.id,
        },
        'Refresh failed - session is not alive',
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (await verifyHash(session.tokenHash, parsed.secret)) {
      return this.rotate(session, { bumpGeneration: true, client });
    }

    if (session.prevTokenHash && (await verifyHash(session.prevTokenHash, parsed.secret))) {
      if (isWithinReuseWindow(session)) {
        // Гонка, а не крадіжка: другий запит із тим самим токеном отримує СВІЙ
        // секрет, але `generation` не рухається і `prev` лишається тим самим —
        // інакше третій паралельний запит уже виглядав би як reuse
        return this.rotate(session, { bumpGeneration: false, client });
      }
      await this.handleReuse(session);
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.revokeStandalone(session.id, 'secret_mismatch');
    this.logger.warn(
      { event: 'auth_refresh_failed', reason: 'secret_mismatch', sid: session.id },
      'Refresh failed - unknown secret, session revoked',
    );
    throw new UnauthorizedException('Invalid refresh token');
  }

  /**
   * Умовний UPDATE (`where: { id, tokenHash }`) — оптимістичне блокування замість
   * `SELECT … FOR UPDATE`: сесію оновлює лише той запит, який бачив саме той хеш,
   * що й читав. Хто програв гонку, отримує `count === 0` і перечитує стан.
   */
  private async rotate(
    session: AuthSession,
    options: { bumpGeneration: boolean; client: ClientContextData },
  ): Promise<ConsumedSession | null> {
    const secret = randomBytes(32).toString('hex');
    const now = new Date();

    const { count } = await this.prisma.authSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: {
        // Перенесений `argon2:`-рядок після першої ж ротації стає `sha256:` —
        // окремої міграції даних для зміни алгоритму не знадобиться
        tokenHash: sha256Hash(secret),
        lastUsedAt: now,
        // Посувається ТІЛЬКИ idle: absolute — стеля від моменту логіну, і ротація
        // не має права її подовжувати, інакше «абсолютний» строк став би вічним
        idleExpiresAt: new Date(now.getTime() + this.idleDays * DAY_MS),
        ip: options.client.ip,
        ...(options.bumpGeneration
          ? {
              prevTokenHash: session.tokenHash,
              prevRotatedAt: now,
              generation: { increment: 1 },
            }
          : {}),
      },
    });

    if (count === 0) {
      return null;
    }

    const updated = await this.prisma.authSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { user: { include: { tenant: true } } },
    });

    return {
      session: updated,
      user: updated.user,
      refreshToken: buildRefreshToken(updated.tenantId, updated.id, secret),
    };
  }

  /**
   * Секрет попереднього покоління поза вікном. Пояснень два, і вони нерозрізнювані
   * ззовні: або токен украли, або клієнт дуже довго тримав відповідь. Тому діємо
   * як за гіршим сценарієм — сесію вбиваємо і кажемо про це власнику.
   */
  private async handleReuse(session: AuthSession & { user: SessionUser }): Promise<void> {
    const revokeAll = this.config.get<string>('AUTH_REUSE_REVOKES_ALL_SESSIONS') === 'true';

    this.logger.error(
      {
        event: 'auth_refresh_reuse_detected',
        sid: session.id,
        userId: session.userId,
        deviceLabel: session.deviceLabel,
        revokeAll,
      },
      'Refresh token reuse detected outside the rotation window',
    );

    await this.tenantTx.withTenantTx(async (tx) => {
      const count = revokeAll
        ? await this.revokeAllForUser(tx, session.userId, 'rotation_reuse')
        : await this.revoke(tx, session.id, 'rotation_reuse');

      await this.notifications.notify(tx, {
        type: 'auth.session_reuse_detected',
        recipientIds: [session.userId],
        // Актор — система: цю дію не ініціювала людина, і в списку сповіщень вона
        // не має виглядати як чийсь вчинок
        actor: { type: 'system' },
        payload: { deviceLabel: session.deviceLabel },
      });

      await this.activities.record(tx, {
        type: 'user.sessions_revoked',
        actor: { type: 'system' },
        payload: {
          user: {
            kind: 'user',
            id: session.userId,
            label: session.user.name ?? session.user.email,
          },
          sessionCount: count,
          reason: 'rotation_reuse',
        },
        links: [{ entityType: 'user', entityId: session.userId, role: 'subject' }],
      });
    });
  }

  // ------------------------------------------------------------- відкликання

  /**
   * `updateMany`, а не `deleteMany`: відкликана сесія лишається рядком. Видалення
   * стерло б різницю між «цієї сесії ніколи не було» і «її щойно вбили» — а саме
   * на цій різниці стоїть reuse-detection і розслідування інцидентів.
   */
  async revoke(
    tx: Prisma.TransactionClient,
    sid: string,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const { count } = await tx.authSession.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  async revokeAllForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: SessionRevokeReason,
    options: { exceptSid?: string } = {},
  ): Promise<number> {
    const { count } = await tx.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.exceptSid && { id: { not: options.exceptSid } }),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Відкликання поза доменною транзакцією (шляхи відмови всередині /auth/refresh) */
  private revokeStandalone(sid: string, reason: SessionRevokeReason): Promise<number> {
    return this.tenantTx.withTenantTx((tx) => this.revoke(tx, sid, reason));
  }

  /** Здача власного токена на виході; мовчазно ідемпотентний — деталі в AuthService */
  async revokeByToken(rawToken: string): Promise<void> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      return;
    }
    this.tenantContext.set(parsed.tenantId);

    const session = await this.prisma.authSession.findUnique({ where: { id: parsed.sid } });
    if (session?.tenantId !== parsed.tenantId || session.revokedAt) {
      return;
    }

    // Невірний секрет НЕ вмикає reuse-detection (на відміну від /refresh): там
    // пред'явлення чужого токена — спроба ним скористатись, тут це щонайбільше
    // спосіб вибити чужу сесію анонімним запитом
    const matches =
      (await verifyHash(session.tokenHash, parsed.secret)) ||
      (session.prevTokenHash !== null && (await verifyHash(session.prevTokenHash, parsed.secret)));
    if (!matches) {
      this.logger.warn(`Logout ignored - secret mismatch for session ${session.id}`);
      return;
    }

    await this.revokeStandalone(session.id, 'logout');
    this.logger.log(`Session ${session.id} revoked on logout (user: ${session.userId})`);
  }

  // ------------------------------------------------------------------ читання

  /** Лише живі й лише свої: мертві сесії — це не рядок зі статусом, а відсутність рядка */
  listForUser(userId: string): Promise<AuthSession[]> {
    const now = new Date();
    return this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Жива сесія, що належить САМЕ цьому юзеру. `userId` у `where` — не надлишок
   * поруч із RLS: політика ізолює тенант, а не людей усередині нього, і без цієї
   * умови колега з того самого тенанта завершував би чужі сесії за їхнім id.
   */
  findOwnLiveSession(userId: string, sid: string): Promise<AuthSession | null> {
    const now = new Date();
    return this.prisma.authSession.findFirst({
      where: {
        id: sid,
        userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
    });
  }

  /** Чи є в юзера жива сесія з таким самим підписом пристрою (ключ «нового пристрою») */
  async hasLiveSessionWithDevice(userId: string, deviceLabel: string | null): Promise<boolean> {
    const now = new Date();
    const existing = await this.prisma.authSession.findFirst({
      where: {
        userId,
        deviceLabel,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  private get idleDays(): number {
    return Number(this.config.get<string>('AUTH_SESSION_IDLE_DAYS') ?? DEFAULT_IDLE_DAYS);
  }

  private get absoluteDays(): number {
    return Number(this.config.get<string>('AUTH_SESSION_ABSOLUTE_DAYS') ?? DEFAULT_ABSOLUTE_DAYS);
  }
}

// --------------------------------------------------------------- хелпери

function buildRefreshToken(tenantId: string, sid: string, secret: string): string {
  return `${tenantId}:${sid}:${secret}`;
}

function parseRefreshToken(raw: string): ParsedToken | null {
  const [tenantId, sid, secret] = raw.split(':');
  if (!tenantId || !sid || !secret) {
    return null;
  }
  return { tenantId, sid, secret };
}

function sha256Hash(secret: string): string {
  return SHA256_PREFIX + createHash('sha256').update(secret).digest('hex');
}

/**
 * sha256 замість argon2 для секрету сесії. argon2 розтягує ключ, щоб зробити
 * дорогим перебір ПАРОЛЯ — рядка з низькою ентропією, який вигадала людина.
 * Тут секрет — 256 випадкових біт: перебирати нічого, а платити ~100 мс CPU на
 * КОЖЕН refresh (тобто на кожен активний пристрій кожні 15 хвилин) — чиста втрата.
 *
 * `argon2:` лишається для рядків, перенесених міграцією зі старої таблиці.
 */
async function verifyHash(stored: string, secret: string): Promise<boolean> {
  if (stored.startsWith(SHA256_PREFIX)) {
    const expected = Buffer.from(stored.slice(SHA256_PREFIX.length), 'hex');
    const actual = createHash('sha256').update(secret).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  if (stored.startsWith(ARGON2_PREFIX)) {
    try {
      return await argon2.verify(stored.slice(ARGON2_PREFIX.length), secret);
    } catch {
      return false;
    }
  }
  return false;
}

function isAlive(session: AuthSession): boolean {
  const now = Date.now();
  return (
    session.revokedAt === null &&
    session.idleExpiresAt.getTime() > now &&
    session.absoluteExpiresAt.getTime() > now
  );
}

function isWithinReuseWindow(session: AuthSession): boolean {
  return (
    session.prevRotatedAt !== null &&
    Date.now() - session.prevRotatedAt.getTime() <= REUSE_WINDOW_MS
  );
}
