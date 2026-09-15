import { Injectable } from '@nestjs/common';
import { PrismaService, TenantContextService } from '@saas-skeleton/database';
import type { Prisma, Tenant, User, VerificationToken } from '@saas-skeleton/database';
import { VerificationPurpose } from '@saas-skeleton/database';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Одноразові посилання (AUTH-3): скидання пароля, зміна email. Один сервіс на всі
 * `purpose` — стани й механіка споживання (атомарний умовний UPDATE) однакові,
 * різниться лише payload. Формат токена — `tenantId:id:secret`, той самий протокол,
 * що в AuthSessionService: id рядка = середній сегмент, секрет ніколи не лежить у БД.
 */

/** `now + 60 хв` — властивість посилання, а не політика тенанта (plan D-15) */
const TTL_MS = 60 * 60 * 1000;

const SHA256_PREFIX = 'sha256:';

export type TokenUser = User & { tenant: Tenant };

export interface IssueInput {
  purpose: VerificationPurpose;
  userId: string;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

export interface PeekedToken {
  token: VerificationToken;
  user: TokenUser;
}

interface ParsedToken {
  tenantId: string;
  id: string;
  secret: string;
}

@Injectable()
export class VerificationTokenService {
  constructor(
    private readonly prisma: PrismaService,
    // Публічні confirm-роути приходять без JWT — контекст доводиться піднімати
    // з префікса самого токена (той самий прийом, що AuthSessionService.verifyAndConsume)
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Видача. Перевидача тієї самої мети інвалідує попередні незвикористані токени
   * ПЕРЕД створенням нового (data-model.md §3) — старе посилання з поштової скриньки
   * перестає працювати одразу, а не мовчки лишається паралельним шляхом входу.
   */
  async issue(tx: Prisma.TransactionClient, input: IssueInput): Promise<string> {
    await tx.verificationToken.updateMany({
      where: { userId: input.userId, purpose: input.purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    const secret = randomBytes(32).toString('hex');
    const created = await tx.verificationToken.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: sha256Hash(secret),
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + TTL_MS),
        createdIp: input.ip ?? null,
      },
    });

    return buildToken(created.tenantId, created.id, secret);
  }

  /**
   * Читання БЕЗ споживання — саме тут перевіряється кілл-свіч (spec FR-033):
   * деактивований юзер чи призупинений тенант мусять отримати ту саму відповідь,
   * що недійсний токен, а сам токен лишитись незвиконаним (щоб повернутись до
   * нього мало сенс, якщо доступ відновлять).
   *
   * Той самий виклик перевіряє й секрет (updateMany не вміє звірити хеш), тому
   * `consume` нижче лише ПОВТОРЮЄ цю звірку атомарно — двоетапний, а не TOCTOU,
   * бо обидва кроки в межах однієї HTTP-транзакції запиту.
   */
  async peek(
    purpose: VerificationPurpose,
    rawToken: string,
  ): Promise<PeekedToken | null> {
    const parsed = parseToken(rawToken);
    if (!parsed) {
      return null;
    }
    this.tenantContext.set(parsed.tenantId);

    const token = await this.prisma.verificationToken.findFirst({
      where: { id: parsed.id, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } },
    });
    if (token?.tenantId !== parsed.tenantId) {
      return null;
    }
    if (!verifyHash(token.tokenHash, parsed.secret)) {
      return null;
    }

    const { user, ...rest } = token;
    return { token: rest, user };
  }

  /**
   * Атомарне споживання: умовний `updateMany` — `count === 0` означає, що токен
   * уже використаний, протух або зник між `peek` і цим викликом (паралельний
   * запит тим самим лінком), і в обох випадках відповідь однакова — 400.
   */
  async consume(
    tx: Prisma.TransactionClient,
    purpose: VerificationPurpose,
    rawToken: string,
  ): Promise<VerificationToken | null> {
    const parsed = parseToken(rawToken);
    if (!parsed) {
      return null;
    }

    const existing = await tx.verificationToken.findUnique({ where: { id: parsed.id } });
    if (!existing) {
      return null;
    }
    if (existing.tenantId !== parsed.tenantId || existing.purpose !== purpose) {
      return null;
    }
    if (!verifyHash(existing.tokenHash, parsed.secret)) {
      return null;
    }

    const { count } = await tx.verificationToken.updateMany({
      where: { id: parsed.id, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return count === 0 ? null : existing;
  }
}

function buildToken(tenantId: string, id: string, secret: string): string {
  return `${tenantId}:${id}:${secret}`;
}

function parseToken(raw: string): ParsedToken | null {
  const [tenantId, id, secret] = raw.split(':');
  if (!tenantId || !id || !secret) {
    return null;
  }
  return { tenantId, id, secret };
}

function sha256Hash(secret: string): string {
  return SHA256_PREFIX + createHash('sha256').update(secret).digest('hex');
}

/**
 * Той самий протокол, що auth-session.service.ts — 256 біт ентропії, argon2 нічого не
 * додає. На відміну від AuthSessionService, тут немає `argon2:`-гілки: verification_tokens
 * — нова таблиця, перенесених legacy-рядків не існує.
 */
function verifyHash(stored: string, secret: string): boolean {
  if (!stored.startsWith(SHA256_PREFIX)) {
    return false;
  }
  const expected = Buffer.from(stored.slice(SHA256_PREFIX.length), 'hex');
  const actual = createHash('sha256').update(secret).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
