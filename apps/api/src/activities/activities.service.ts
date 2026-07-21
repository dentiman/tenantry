import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { Activity } from '@saas-skeleton/database';
import type { ActivityQuery } from '@saas-skeleton/contracts';

/** Курсор — непрозорий base64url("{createdAt ISO}|{id}"); формат — деталь бекенда */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const createdAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(createdAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt, id };
}

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset-пагінація (не Prisma-cursor: умова складена вручну). Сортування
   * createdAt DESC, id DESC — tie-breaker по id обов'язковий (та сама причина,
   * що в users.service). Беремо limit+1: зайвий рядок = є наступна сторінка.
   */
  async findAll(query: ActivityQuery): Promise<{ items: Activity[]; nextCursor: string | null }> {
    const { entityType, entityId, type, limit } = query;
    const cursor = decodeCursor(query.cursor);
    this.logger.debug(
      `Activity feed for ${entityType}:${entityId} (type: ${type ?? 'all'}, limit: ${String(limit)})`,
    );

    const rows = await this.prisma.activity.findMany({
      where: {
        links: { some: { entityType, entityId } },
        ...(type && { type }),
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }
}
