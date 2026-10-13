import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '@saas-skeleton/database';
import type {
  ChannelUnroutableListQuery,
  ChannelUnroutableListResponse,
} from '@saas-skeleton/contracts/platform';

/**
 * Журнал вебхуків каналів, що не знайшли тенанта (CHAT-2a). Таблиця без tenant_id і без RLS:
 * пише лише SECURITY DEFINER-функція tenant-api, читає лише роль control plane.
 */
@Injectable()
export class ChannelEventsService {
  constructor(private readonly prisma: SystemPrismaService) {}

  async unroutable(query: ChannelUnroutableListQuery): Promise<ChannelUnroutableListResponse> {
    const where = query.reason ? { reason: query.reason } : {};
    const [rows, total] = await Promise.all([
      this.prisma.channelUnroutableEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.channelUnroutableEvent.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        keyHash: row.keyHash,
        reason: row.reason,
        ip: row.ip,
        receivedAt: row.receivedAt.toISOString(),
      })),
      total,
    };
  }
}
