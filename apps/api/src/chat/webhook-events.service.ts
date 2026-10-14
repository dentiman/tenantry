import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { WebhookEvent } from '@saas-skeleton/contracts';

/**
 * Захоплені вебхуки акаунта для адміна (CHAT-3b1, chat/webhook-events): як збережено — тіло байт-в-байт,
 * заголовки, результат підпису. Новіші спершу; keyset по `(received_at, id)` з непрозорим курсором.
 */
@Injectable()
export class WebhookEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    accountId: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: WebhookEvent[]; nextCursor: string | null }> {
    // RLS: чужий акаунт для цього тенанта не існує
    const account = await this.prisma.messagingAccount.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Messaging account not found');

    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.channelWebhookEvent.findMany({
      where: {
        accountId,
        ...(cursor && {
          OR: [{ receivedAt: { lt: cursor.at } }, { receivedAt: cursor.at, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        receivedAt: row.receivedAt.toISOString(),
        state: row.state,
        error: row.error,
        signatureValid: row.signatureValid,
        headers: (row.headers ?? {}) as Record<string, string>,
        body: row.body,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.receivedAt, last.id) : null,
    };
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep < 0) return null;
  const at = new Date(decoded.slice(0, sep));
  return Number.isNaN(at.getTime()) ? null : { at, id: decoded.slice(sep + 1) };
}
