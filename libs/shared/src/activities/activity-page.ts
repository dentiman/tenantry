import { BadRequestException } from '@nestjs/common';
import type { Activity, Prisma } from '@saas-skeleton/database';
import type { ActivityListResponse, ActivityResponse } from '@saas-skeleton/contracts';

/**
 * Читання журналу — спільне для обох плейнів, як і запис (`ActivityRecorder`). Тенантна
 * стрічка ходить через RLS-клієнт, стрічка тенанта в control plane — через system-клієнт із
 * явним `tenantId` у `where`; курсор, сортування і мапінг при цьому мусять збігатися, тому
 * вони тут, а не в кожному застосунку.
 */

/** Мінімум клієнта, який потрібен сторінці: підходять і PrismaService, і SystemPrismaService */
export interface ActivityReadClient {
  activity: { findMany(args: Prisma.ActivityFindManyArgs): Promise<Activity[]> };
}

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

/**
 * Keyset-пагінація (не Prisma-cursor: умова складена вручну). Сортування
 * createdAt DESC, id DESC — tie-breaker по id обов'язковий (та сама причина,
 * що в users.service). Беремо limit+1: зайвий рядок = є наступна сторінка.
 */
export async function readActivityPage(
  client: ActivityReadClient,
  where: Prisma.ActivityWhereInput,
  rawCursor: string | undefined,
  limit: number,
): Promise<{ items: Activity[]; nextCursor: string | null }> {
  const cursor = decodeCursor(rawCursor);

  const rows = await client.activity.findMany({
    where: {
      ...where,
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

/**
 * type/actorType зберігаються в БД як string; валідність гарантує вхідний контракт
 * (ACTIVITY_TYPES у recorder-і). payload — Json, форму звужує ACTIVITY_PAYLOAD_SCHEMAS[type].
 */
export function toActivityResponse(a: Activity): ActivityResponse {
  return {
    id: a.id,
    type: a.type as ActivityResponse['type'],
    actorType: a.actorType as ActivityResponse['actorType'],
    actorId: a.actorId,
    actorLabel: a.actorLabel,
    payload: a.payload as Record<string, unknown>,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toActivityListResponse(page: {
  items: Activity[];
  nextCursor: string | null;
}): ActivityListResponse {
  return { items: page.items.map(toActivityResponse), nextCursor: page.nextCursor };
}
