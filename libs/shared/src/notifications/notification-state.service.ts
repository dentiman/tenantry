import { Injectable } from '@nestjs/common';
import { PrismaService, TenantContextService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { NotificationSummary } from '@saas-skeleton/contracts';

/**
 * Стан інбокса юзера: `seen_at` (гасить бейдж) і `revision` (детект пропущеної
 * socket-події за патерном presence).
 *
 * `tenantId` тут передається явно — на відміну від решти таблиць, де його кладе
 * DB-default. Причина: PK композитний (tenant_id, user_id), і `where` upsert-у без
 * нього не складеш. Це legal: сервіс — інфраструктура, а не домен (той самий виняток,
 * що в PresenceController і в recorder-і, який бере tenantId для назви room-а).
 *
 * `increment` компілюється в один `INSERT … ON CONFLICT … DO UPDATE SET revision =
 * revision + $n` (перевірено логом Postgres), тому два паралельні fan-out-и не
 * зʼїдять ревізію один одного.
 */
@Injectable()
export class NotificationStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Порахувати ревізію вперед. Викликається В ТІЙ САМІЙ транзакції, що й зміна */
  async bumpRevision(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const tenantId = this.tenantContext.requireTenantId();
    const state = await tx.notificationState.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId, revision: 1 },
      update: { revision: { increment: 1 } },
      select: { revision: true },
    });
    return state.revision;
  }

  /** Панель відкрито: бейдж гасне, стан рядків не змінюється */
  async markSeen(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const tenantId = this.tenantContext.requireTenantId();
    const seenAt = new Date();
    const state = await tx.notificationState.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId, seenAt, revision: 1 },
      update: { seenAt, revision: { increment: 1 } },
      select: { revision: true },
    });
    return state.revision;
  }

  /**
   * Snapshot бейджа. Читається ПІСЛЯ коміту (з нетранзакційного клієнта), тому
   * бачить уже застосовану зміну.
   *
   * `newCount` рахується по `updated_at`, а не `created_at`: схлопнута група, у якій
   * після останнього перегляду з'явилась нова подія, — це теж «нове».
   */
  async summary(userId: string): Promise<NotificationSummary> {
    const state = await this.prisma.notificationState.findUnique({
      where: { tenantId_userId: { tenantId: this.tenantContext.requireTenantId(), userId } },
    });
    const seenAt = state?.seenAt ?? null;

    const live = { recipientId: userId, readAt: null, archivedAt: null };
    const [unreadCount, newCount] = await Promise.all([
      this.prisma.notification.count({ where: live }),
      seenAt
        ? this.prisma.notification.count({ where: { ...live, updatedAt: { gt: seenAt } } })
        : this.prisma.notification.count({ where: live }),
    ]);

    return {
      unreadCount,
      newCount,
      revision: state?.revision ?? 0,
      generatedAt: new Date().toISOString(),
    };
  }
}
