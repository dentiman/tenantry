import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import type {
  TenantActivityListResponse,
  TenantActivityQuery,
} from '@saas-skeleton/contracts/platform';
import { readActivityPage, toActivityListResponse } from '@saas-skeleton/shared/activities';

/**
 * Стрічка подій усього тенанта для оператора платформи — операційний зріз («що там сталося
 * вчора о 15:00»), а не копія бізнес-екрану: у tenant-плані повної хронології немає ні в кого,
 * загальна стрічка воркспейсу відфільтрована за `WORKSPACE_ACTIVITY_TYPES`.
 *
 * Оператор бачить УСІ типи (рішення 2026-10-18), зокрема безпекові й приватні події
 * календаря. system-клієнт BYPASSRLS, тож межу тенанта тримає лише `tenantId` у `where` —
 * він стоїть першим і не перекривається фільтрами запиту. Курсор і мапінг — спільні з
 * tenant-api (`libs/shared/src/activities/activity-page.ts`).
 */
@Injectable()
export class TenantActivitiesService {
  constructor(private readonly prisma: SystemPrismaService) {}

  async findAll(
    tenantId: string,
    query: TenantActivityQuery,
  ): Promise<TenantActivityListResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant with id "${tenantId}" not found`);

    const page = await readActivityPage(
      this.prisma,
      { tenantId, ...(query.type && { type: query.type }) },
      query.cursor,
      query.limit,
    );
    return toActivityListResponse(page);
  }
}
