import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { Activity, Prisma } from '@saas-skeleton/database';
import { readActivityPage } from '@saas-skeleton/shared';
import { WORKSPACE_ACTIVITY_TYPES } from '@saas-skeleton/contracts';
import type { ActivityQuery, WorkspaceActivityQuery } from '@saas-skeleton/contracts';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Стрічка однієї сутності: подія має лінк на `{entityType, entityId}` */
  async findAll(query: ActivityQuery): Promise<{ items: Activity[]; nextCursor: string | null }> {
    const { entityType, entityId, type, limit } = query;
    this.logger.debug(
      `Activity feed for ${entityType}:${entityId} (type: ${type ?? 'all'}, limit: ${String(limit)})`,
    );
    return this.page(
      { links: { some: { entityType, entityId } }, ...(type && { type }) },
      query.cursor,
      limit,
    );
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
