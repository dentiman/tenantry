import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import type { NormalizedStatusEvent } from '@saas-skeleton/contracts';

/** Скільки разів підмітання пробує квитанцію, що так і не знайшла свого повідомлення */
export const PENDING_STATUS_MAX_ATTEMPTS = 5;

export interface MessageRef {
  messageId: string;
  conversationId: string;
}

export interface FoldResult {
  /** Повідомлення знайдено (навіть якщо квитанція нічого не змінила) */
  matched: boolean;
  /** Квитанція справді зрушила стан — тільки тоді браузеру є що перечитувати */
  changed: MessageRef | null;
}

interface TargetRow {
  id: string;
  conversation_id: string;
  external_id: string | null;
}

/**
 * Згортання квитанцій провайдера в стан вихідного повідомлення (CHAT-2b, design.md D10;
 * docs/whatsapp-channel.md §4.4). Усі рішення про «вперед чи ні» ухвалює БАЗА одним умовним
 * `UPDATE … WHERE`, а не код після читання: тоді паралельні й переставлені квитанції дають той
 * самий підсумок, що й у порядку надходження.
 *
 * Шкала: QUEUED 0 < SENDING 1 < SENT 2 = FAILED 2 < DELIVERED 3 < READ 4.
 * - `sent` рухає лише з QUEUED/SENDING (запізнілий `sent` не скасовує ні FAILED, ні доставку);
 * - `delivered` перекриває будь-що нижче, зокрема FAILED, і очищає причину відмови;
 * - `read` — усе, крім самого READ;
 * - `failed` — лише з QUEUED/SENDING/SENT (не перекриває доставку).
 *
 * Канал береться з підписаного акаунта викликачем, тож квитанція не зачепить чужий канал; RLS —
 * друга стіна проти чужого тенанта.
 */
@Injectable()
export class ChannelStatusService {
  private readonly logger = new Logger(ChannelStatusService.name);

  /** Застосувати квитанцію до повідомлення каналу; якщо повідомлення ще нема — запаркувати */
  async foldOrPark(
    tx: Prisma.TransactionClient,
    channel: { id: string; accountId: string },
    event: NormalizedStatusEvent,
  ): Promise<FoldResult> {
    const result = await this.fold(tx, channel.id, event);
    if (!result.matched) {
      await tx.channelPendingStatus.create({
        data: {
          accountId: channel.accountId,
          channelExternalId: event.channelExternalId,
          externalId: event.externalMessageId,
          opaqueId: event.opaqueId,
          status: event.status,
          occurredAt: new Date(event.occurredAt),
          failure: event.failure ?? undefined,
        },
      });
    }
    return result;
  }

  /** Лише застосування (без паркування) — для підмітання й для запису `external_id` */
  async fold(
    tx: Prisma.TransactionClient,
    channelId: string,
    event: Pick<NormalizedStatusEvent, 'externalMessageId' | 'opaqueId' | 'status' | 'occurredAt' | 'failure'>,
  ): Promise<FoldResult> {
    const target = await this.findTarget(tx, channelId, event.externalMessageId, event.opaqueId);
    if (!target) {
      return { matched: false, changed: null };
    }

    // Провайдерський id записується, щойно ми його вперше побачили: це не «зміна стану», але без
    // нього наступні квитанції не знайшли б повідомлення за external_id
    if (target.external_id === null) {
      await tx.$executeRaw`
        UPDATE chat_messages SET external_id = ${event.externalMessageId}
        WHERE id = ${target.id} AND external_id IS NULL`;
    }

    const at = event.occurredAt;
    let updated: number;
    switch (event.status) {
      case 'sent':
        updated = await tx.$executeRaw`
          UPDATE chat_messages
          SET status = 'SENT', sent_at = COALESCE(sent_at, (${at}::timestamptz AT TIME ZONE 'UTC'))
          WHERE id = ${target.id} AND status IN ('QUEUED', 'SENDING')`;
        break;
      case 'delivered':
        updated = await tx.$executeRaw`
          UPDATE chat_messages
          SET status = 'DELIVERED',
              sent_at = COALESCE(sent_at, (${at}::timestamptz AT TIME ZONE 'UTC')),
              delivered_at = COALESCE(delivered_at, (${at}::timestamptz AT TIME ZONE 'UTC')),
              failure = NULL
          WHERE id = ${target.id} AND status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')`;
        break;
      case 'read':
        updated = await tx.$executeRaw`
          UPDATE chat_messages
          SET status = 'READ',
              sent_at = COALESCE(sent_at, (${at}::timestamptz AT TIME ZONE 'UTC')),
              delivered_at = COALESCE(delivered_at, (${at}::timestamptz AT TIME ZONE 'UTC')),
              read_at = COALESCE(read_at, (${at}::timestamptz AT TIME ZONE 'UTC')),
              failure = NULL
          WHERE id = ${target.id} AND status <> 'READ'`;
        break;
      case 'failed':
        updated = await tx.$executeRaw`
          UPDATE chat_messages
          SET status = 'FAILED', failure = ${JSON.stringify(event.failure ?? defaultFailure())}::jsonb
          WHERE id = ${target.id} AND status IN ('QUEUED', 'SENDING', 'SENT')`;
        break;
    }

    return {
      matched: true,
      changed: updated > 0 ? { messageId: target.id, conversationId: target.conversation_id } : null,
    };
  }

  /**
   * Застосувати запарковані квитанції до повідомлення, чий `external_id` щойно записано (або яке
   * щойно знайшлося). Порядок за часом провайдера: `delivered`, потім `read`.
   */
  async applyPending(
    tx: Prisma.TransactionClient,
    message: { id: string; externalId: string | null; channelId: string },
  ): Promise<MessageRef[]> {
    const pending = await tx.channelPendingStatus.findMany({
      where: {
        OR: [
          ...(message.externalId ? [{ externalId: message.externalId }] : []),
          { opaqueId: message.id },
        ],
      },
      orderBy: { occurredAt: 'asc' },
    });
    const changed: MessageRef[] = [];
    for (const row of pending) {
      const result = await this.fold(tx, message.channelId, {
        externalMessageId: row.externalId ?? message.externalId ?? '',
        opaqueId: row.opaqueId,
        status: row.status as NormalizedStatusEvent['status'],
        occurredAt: row.occurredAt.toISOString(),
        failure: (row.failure as NormalizedStatusEvent['failure']) ?? null,
      });
      if (result.matched) {
        await tx.channelPendingStatus.delete({ where: { id: row.id } });
        if (result.changed) changed.push(result.changed);
      }
    }
    return changed;
  }

  /**
   * Одна пара «повідомлення в каналі»: за `external_id` у межах каналу, а якщо провайдер повернув
   * наш id — і за ним (канал той самий). Лише вихідні: квитанція про вхідне нічого не означає.
   */
  private async findTarget(
    tx: Prisma.TransactionClient,
    channelId: string,
    externalId: string,
    opaqueId: string | null,
  ): Promise<TargetRow | null> {
    const rows = await tx.$queryRaw<TargetRow[]>`
      SELECT id, conversation_id, external_id
      FROM chat_messages
      WHERE direction = 'OUTBOUND' AND channel_id = ${channelId}
        AND (external_id = ${externalId} OR (${opaqueId}::text IS NOT NULL AND id = ${opaqueId}))
      ORDER BY (external_id = ${externalId}) DESC
      LIMIT 1`;
    return rows[0] ?? null;
  }

  logDiscard(count: number): void {
    if (count > 0) {
      this.logger.warn(`Discarded ${String(count)} pending delivery receipt(s) that matched no message`);
    }
  }
}

function defaultFailure(): { class: string; code: string; title: string } {
  return { class: 'TRANSIENT', code: 'unknown', title: 'Delivery failed' };
}
