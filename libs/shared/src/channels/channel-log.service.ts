import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { ChannelLogEntry } from '@saas-skeleton/contracts';
import { redactSecrets } from './meta-cloud/graph-client';

/** Скільки днів лежить запис журналу викликів; далі його прибирає щодобовий `channels.purge-logs` */
export const CHANNEL_LOG_RETENTION_DAYS = 30;

/**
 * Усе, що можна покласти в `detail`. Білий список, а не вільний JSON (design.md D8): журнал каже, ЩО
 * сталося (який виклик, який код), а не ЩО було сказано — вміст повідомлення, токен і повний номер
 * потрапити сюди не можуть за побудовою.
 */
export interface LogDetail {
  /** Шлях запиту без query (`123/messages`) */
  endpoint?: string;
  /** Останні чотири цифри отримувача */
  recipientLast4?: string;
  /** Наш `wamid`: id повідомлення в провайдера (безпечний лише в межах тенанта — не виносити в метрики) */
  providerMessageId?: string;
  pages?: number;
  numbers?: number;
}

export interface LogEntryInput {
  accountId: string;
  operation: 'verify' | 'sync' | 'send' | 'webhook' | 'read';
  ok: boolean;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorTitle?: string | null;
  durationMs: number;
  messageId?: string | null;
  detail?: LogDetail;
  /** Секрети, яких не має бути в `errorTitle` (токен, app secret) */
  secrets?: readonly string[];
}

const TITLE_MAX = 200;

/** Лише цифри, лише чотири останні: повний номер у журнал не потрапляє */
export function last4(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

function pickDetail(detail: LogDetail | undefined): Prisma.InputJsonObject {
  const out: Record<string, string | number> = {};
  if (typeof detail?.endpoint === 'string') out.endpoint = detail.endpoint.split('?')[0] ?? '';
  if (typeof detail?.recipientLast4 === 'string')
    out.recipientLast4 = detail.recipientLast4.slice(-4);
  if (typeof detail?.providerMessageId === 'string')
    out.providerMessageId = detail.providerMessageId;
  if (typeof detail?.pages === 'number') out.pages = detail.pages;
  if (typeof detail?.numbers === 'number') out.numbers = detail.numbers;
  return out;
}

/**
 * Журнал викликів до провайдера (CHAT-3a, chat/channel-logs). `record` бере `tx` першим аргументом, як
 * решта записувачів: запис про відправку лягає в ту саму транзакцію, що й її результат.
 */
@Injectable()
export class ChannelLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Prisma.TransactionClient, entry: LogEntryInput): Promise<void> {
    await tx.channelLog.create({
      data: {
        accountId: entry.accountId,
        messageId: entry.messageId ?? null,
        operation: entry.operation,
        ok: entry.ok,
        httpStatus: entry.httpStatus ?? null,
        errorCode: entry.errorCode ?? null,
        errorTitle:
          entry.errorTitle === null || entry.errorTitle === undefined
            ? null
            : redactSecrets(entry.errorTitle, entry.secrets ?? []).slice(0, TITLE_MAX),
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        detail: pickDetail(entry.detail),
      },
    });
  }

  /** Новіші спершу; keyset по `(created_at, id)` — непрозорий курсор */
  async list(
    accountId: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: ChannelLogEntry[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.channelLog.findMany({
      where: {
        accountId,
        ...(cursor && {
          OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        operation: row.operation as ChannelLogEntry['operation'],
        ok: row.ok,
        httpStatus: row.httpStatus,
        errorCode: row.errorCode,
        errorTitle: row.errorTitle,
        durationMs: row.durationMs,
        messageId: row.messageId,
        detail: row.detail as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
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
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  return sep === -1 || Number.isNaN(at.getTime()) || !id ? null : { at, id };
}
