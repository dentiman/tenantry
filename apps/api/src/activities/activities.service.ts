import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import { Role } from '@saas-skeleton/database';
import type { Activity, Prisma } from '@saas-skeleton/database';
import { readActivityPage } from '@saas-skeleton/shared';
import {
  RESTRICTED_ACTIVITY_TYPES,
  WORKSPACE_ACTIVITY_TYPES,
} from '@saas-skeleton/contracts';
import type { ActivityQuery, WorkspaceActivityQuery } from '@saas-skeleton/contracts';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ActivityAccessRegistry } from './activity-access.registry';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ActivityAccessRegistry,
  ) {}

  /**
   * Стрічка однієї сутності: подія має лінк на `{entityType, entityId}`. RLS тримає межу тенанта,
   * а що з цього бачить САМЕ цей глядач — `visibilityOf`: стрічка адресується id, тож без нього
   * будь-хто читав би приватні події календаря через стрічку клієнта і безпекові події колег.
   */
  async findAll(
    query: ActivityQuery,
    viewer: JwtPayload,
  ): Promise<{ items: Activity[]; nextCursor: string | null }> {
    const { entityType, entityId, type, limit } = query;
    this.logger.debug(
      `Activity feed for ${entityType}:${entityId} (type: ${type ?? 'all'}, limit: ${String(limit)})`,
    );
    return this.page(
      {
        AND: [
          { links: { some: { entityType, entityId } } },
          ...(type ? [{ type }] : []),
          ...(await this.visibilityOf(viewer, entityType, entityId)),
        ],
      },
      query.cursor,
      limit,
    );
  }

  /**
   * Умови видимості для стрічки сутності (накладаються через AND до pagination, тож приховане не
   * з'їдає слотів сторінки й не ламає курсор):
   *
   * 1. безпекові типи (`restricted`) — лише субʼєкту (лінк `user:<глядач>`) і ADMIN;
   * 2. записи з лінком на екземпляр сутності, який глядачу не видно, — рішення охоронця, що його
   *    зареєстрував модуль-власник сутності (`ActivityAccessRegistry`). Кандидати — id такого типу
   *    серед записів САМЕ цієї стрічки, тож запит не росте разом із журналом тенанта.
   */
  private async visibilityOf(
    viewer: JwtPayload,
    entityType: string,
    entityId: string,
  ): Promise<Prisma.ActivityWhereInput[]> {
    const conditions: Prisma.ActivityWhereInput[] = [];

    if (viewer.role !== Role.ADMIN && RESTRICTED_ACTIVITY_TYPES.length > 0) {
      conditions.push({
        OR: [
          { type: { notIn: [...RESTRICTED_ACTIVITY_TYPES] } },
          { links: { some: { entityType: 'user', entityId: viewer.sub } } },
        ],
      });
    }

    for (const [guardedType, guard] of this.access.all()) {
      const links = await this.prisma.activityLink.findMany({
        where: {
          entityType: guardedType,
          activity: { links: { some: { entityType, entityId } } },
        },
        select: { entityId: true },
        distinct: ['entityId'],
      });
      if (links.length === 0) {
        continue;
      }
      const candidates = links.map((link) => link.entityId);
      const visible = await guard.visibleIds(viewer, candidates);
      const hidden = candidates.filter((id) => !visible.has(id));
      if (hidden.length > 0) {
        conditions.push({
          NOT: { links: { some: { entityType: guardedType, entityId: { in: hidden } } } },
        });
      }
    }
    return conditions;
  }

  /**
   * Загальна стрічка воркспейсу: усі події тенанта (його межу тримає RLS), але ЛИШЕ типів, які
   * власник дозволив показувати кожному юзеру (`WORKSPACE_ACTIVITY_TYPES`). Фільтр за типом, а не
   * за рівнем запису: доступ до окремого запису (приватна подія календаря) активності невідомий,
   * тож такі типи в стрічку просто не потрапляють. Список типів задає сервер — клієнт його
   * розширити не може.
   */
  async findWorkspace(
    query: WorkspaceActivityQuery,
  ): Promise<{ items: Activity[]; nextCursor: string | null }> {
    this.logger.debug(`Workspace activity feed (limit: ${String(query.limit)})`);
    return this.page({ type: { in: [...WORKSPACE_ACTIVITY_TYPES] } }, query.cursor, query.limit);
  }

  private page(
    where: Prisma.ActivityWhereInput,
    rawCursor: string | undefined,
    limit: number,
  ): Promise<{ items: Activity[]; nextCursor: string | null }> {
    // Курсор і сортування — спільні з control plane (libs/shared/src/activities/activity-page.ts)
    return readActivityPage(this.prisma, where, rawCursor, limit);
  }
}
