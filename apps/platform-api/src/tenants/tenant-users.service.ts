import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SystemPrismaService } from '@saas-skeleton/database';
import type { User } from '@saas-skeleton/database';
import type {
  TenantUserListResponse,
  TenantUserQuery,
  TenantUserResponse,
  TenantUserSessionsRevokedResponse,
} from '@saas-skeleton/contracts/platform';
import { ActivityRecorder } from '@saas-skeleton/shared/activities';
import * as argon2 from 'argon2';
import type { PlatformJwtPayload } from '../auth/decorators/current-operator.decorator';

type AuditAction =
  | 'tenant_user.password_set'
  | 'tenant_user.enabled'
  | 'tenant_user.disabled'
  | 'tenant_user.sessions_revoked';

/**
 * Аварійне керування юзерами tenant-а оператором платформи (забутий пароль єдиного адміна).
 * Кожна дія лишає ДВА сліди в одній транзакції: `platform_audit_events` (журнал платформи)
 * і tenant-ову activity з актором `system` — tenant-адмін бачить у стрічці юзера, що
 * дію виконала система. Ні пароля, ні хеша, ні довжини в жодному з них немає.
 *
 * system-клієнт BYPASSRLS і tenant-контексту не має: DB-default `tenant_id` = NULL, тому
 * `tenantId` скрізь передається явно, а юзер завжди шукається парою (id, tenantId).
 * Межа: access JWT (15m) і відкриті socket-и живуть до закінчення — realtime-gateway
 * є лише в tenant-api; refresh-сесії відкликаються одразу.
 */
@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(
    private readonly prisma: SystemPrismaService,
    private readonly activities: ActivityRecorder,
  ) {}

  async findAll(tenantId: string, query: TenantUserQuery): Promise<TenantUserListResponse> {
    await this.assertTenant(tenantId);
    const { page, limit, role, isActive, search, sortBy, sortOrder } = query;

    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    // tie-breaker по id обов'язковий — інакше пагінація "пливе" при рівних значеннях sortBy
    const orderBy: Prisma.UserOrderByWithRelationInput[] = sortBy
      ? [{ [sortBy]: sortOrder ?? 'asc' }, { id: 'desc' }]
      : [{ createdAt: 'asc' }, { id: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map(toTenantUserResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async setPassword(
    tenantId: string,
    userId: string,
    password: string,
    operator: PlatformJwtPayload,
  ): Promise<void> {
    const user = await this.findUser(tenantId, userId);
    // argon2 рахуємо ДО транзакції — ~100мс CPU не варті відкритої транзакції
    const passwordHash = await argon2.hash(password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // Сесії відкликаємо, а не видаляємо — рядок лишається слідом інциденту
      const revokedCount = await this.revokeSessions(tx, tenantId, user.id, 'password_change');
      await this.recordActivity(tx, 'user.password_changed', user);
      await this.audit(tx, 'tenant_user.password_set', operator, user, { revokedCount });
    });
    this.logger.log(
      `Operator ${operator.email} set a new password for user ${user.id} (tenant ${tenantId})`,
    );
  }

  /** Повторний виклик із тим самим значенням — no-op без сліду (як у tenant-api) */
  async setStatus(
    tenantId: string,
    userId: string,
    isActive: boolean,
    operator: PlatformJwtPayload,
  ): Promise<TenantUserResponse> {
    return this.prisma.$transaction(async (tx) => {
      // Умовний updateMany: рішення «чи змінилось» приймає сам UPDATE, а не читання до нього
      const { count } = await tx.user.updateMany({
        where: { id: userId, tenantId, isActive: !isActive },
        data: { isActive },
      });
      const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
      if (!user) throw notFound(userId);
      if (count === 0) return toTenantUserResponse(user);

      let revokedCount = 0;
      if (!isActive) {
        // Вимкнення = kill-switch: сесії йдуть разом із доступом
        revokedCount = await this.revokeSessions(tx, tenantId, user.id, 'user_disabled');
      }
      await this.recordActivity(tx, isActive ? 'user.enabled' : 'user.disabled', user);
      await this.audit(
        tx,
        isActive ? 'tenant_user.enabled' : 'tenant_user.disabled',
        operator,
        user,
        { revokedCount },
      );
      return toTenantUserResponse(user);
    });
  }

  async revokeAllSessions(
    tenantId: string,
    userId: string,
    operator: PlatformJwtPayload,
  ): Promise<TenantUserSessionsRevokedResponse> {
    const user = await this.findUser(tenantId, userId);
    return this.prisma.$transaction(async (tx) => {
      const revokedCount = await this.revokeSessions(tx, tenantId, user.id, 'revoke_all');
      await this.recordActivity(tx, 'user.sessions_revoked', user, {
        sessionCount: revokedCount,
        reason: 'revoke_all',
      });
      await this.audit(tx, 'tenant_user.sessions_revoked', operator, user, { revokedCount });
      return { revokedCount };
    });
  }

  private async assertTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant with id "${tenantId}" not found`);
  }

  /** Юзер іншого tenant-а — 404, а не 403: існування чужих id не розкриваємо */
  private async findUser(tenantId: string, userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw notFound(userId);
    return user;
  }

  private async revokeSessions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<number> {
    const { count } = await tx.authSession.updateMany({
      where: { userId, tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  private recordActivity(
    tx: Prisma.TransactionClient,
    type: 'user.password_changed' | 'user.enabled' | 'user.disabled' | 'user.sessions_revoked',
    user: User,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.activities.record(tx, {
      type,
      tenantId: user.tenantId,
      // Дію виконує платформа, а не людина з tenant-а: актор — `system`
      actor: { type: 'system' },
      payload: { user: { kind: 'user', id: user.id, label: user.name ?? user.email }, ...extra },
      links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    action: AuditAction,
    operator: PlatformJwtPayload,
    user: User,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.platformAuditEvent.create({
      data: {
        action,
        tenantId: user.tenantId,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        actorId: operator.sub,
        actorLabel: operator.email,
        details,
      },
    });
  }
}

function notFound(userId: string): NotFoundException {
  return new NotFoundException(`User with id "${userId}" not found`);
}

function toTenantUserResponse(user: User): TenantUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
