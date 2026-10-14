import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import type { NormalizedMessageEvent } from '@saas-skeleton/contracts';
import { toPreview } from '../chat/preview';
import { NonRetryableMessageError } from '../messaging/messaging.errors';
import { ConversationWorkflow } from '../chat/conversation-workflow';
import { ChannelAdapterRegistry } from './channel-adapter-registry';
import { ChannelContactService } from './channel-contact.service';
import { ChannelStatusService, type MessageRef } from './channel-status.service';

/** Вікно, у межах якого вхідне повертає РОЗВ'ЯЗАНУ розмову у роботу (O-W4); `channels.settings.reopenHours` */
export const DEFAULT_REOPEN_HOURS = 24;

export interface IngestOutcome {
  /** Нових повідомлень збережено (дублікати й нерозібране не рахуються) */
  stored: number;
  /** Розмови, у яких щось змінилося: за ними браузер перечитує скриньку */
  changedConversationIds: string[];
  /** Нові вхідні повідомлення: за ними викликач публікує подію для сповіщень (CHAT-2b) */
  storedMessages: MessageRef[];
  /** Вихідні, чий стан змінила квитанція: за ними браузер перечитує повідомлення (CHAT-2b) */
  updatedMessages: MessageRef[];
  state: 'PROCESSED' | 'FAILED' | 'UNROUTABLE' | 'SKIPPED';
  error?: string;
}

interface ChannelRow {
  id: string;
  accountId: string;
  isEnabled: boolean;
  settings: unknown;
}

/**
 * Ingest вхідних подій каналу (docs/whatsapp-channel.md §4.3; design.md D4–D6). Усе в
 * ТРАНЗАКЦІЇ ВИКЛИКАЧА (`tx` першим аргументом): воркер відкриває її через `inbox.runOnce`.
 *
 * Інваріанти, на яких усе стоїть:
 * - повідомлення провайдера зберігається рівно один раз (часткове UNIQUE по `external_id`); дублікат
 *   НЕ бере `seq` — тож дірок у нумерації не народжується;
 * - одна відкрита розмова на контакт — теж індекс, а не перевірка в коді: гонку виграє той, хто
 *   вставив першим, програвший перечитує;
 * - автоматично клієнт привʼязується лише коли номер належить РІВНО одному;
 * - жодного автостворення клієнта і жодного злиття контактів.
 */
@Injectable()
export class ChannelIngestService {
  private readonly logger = new Logger(ChannelIngestService.name);

  // Без стану й залежностей: створюється тут, а не через DI, щоб конструктор ingest не змінювався
  private readonly contacts = new ChannelContactService();

  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly statuses: ChannelStatusService,
    private readonly workflow: ConversationWorkflow,
  ) {}

  /** Розібрати збережений вебхук і застосувати його повідомлення; позначити стан рядка події */
  async ingestEvent(tx: Prisma.TransactionClient, eventId: string): Promise<IngestOutcome> {
    const event = await tx.channelWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      // Рядок видалено retention-кроном раніше за роботу — повторювати нема чого
      throw new NonRetryableMessageError(`Webhook event ${eventId} not found`);
    }
    if (event.state !== 'RECEIVED') {
      return emptyOutcome('SKIPPED');
    }

    const account = await tx.messagingAccount.findUnique({
      where: { id: event.accountId },
      select: { id: true, provider: true },
    });
    const adapter = account ? this.registry.get(account.provider) : undefined;
    if (!account || !adapter) {
      return this.finish(tx, eventId, { ...emptyOutcome('FAILED'), error: 'no_adapter' });
    }

    const parsed = adapter.parseWebhook(Buffer.from(event.body, 'utf8'));
    if (parsed.error !== undefined) {
      return this.finish(tx, eventId, { ...emptyOutcome('FAILED'), error: parsed.error });
    }

    const changed = new Set<string>();
    const stored: MessageRef[] = [];
    const updated: MessageRef[] = [];
    const unroutable: string[] = [];

    for (const item of parsed.events) {
      if (item.kind !== 'message' && item.kind !== 'status') continue;

      const route = await this.routeChannel(tx, account, item.channelExternalId);
      if (!route.ok) {
        unroutable.push(route.reason);
        continue;
      }

      if (item.kind === 'status') {
        const fold = await this.statuses.foldOrPark(tx, route.channel, item);
        if (fold.changed) updated.push(fold.changed);
        continue;
      }

      const ingested = await this.ingestMessage(tx, route.channel, item);
      if (ingested) {
        stored.push(ingested);
        changed.add(ingested.conversationId);
      }
    }

    // Усе, що було повідомленнями, виявилось нероутованим — подія нічого не дала
    const onlyUnroutable =
      stored.length === 0 && updated.length === 0 && changed.size === 0 && unroutable.length > 0;
    return this.finish(tx, eventId, {
      stored: stored.length,
      changedConversationIds: [...changed],
      storedMessages: stored,
      updatedMessages: updated,
      state: onlyUnroutable ? 'UNROUTABLE' : 'PROCESSED',
      ...(unroutable.length > 0 && { error: [...new Set(unroutable)].join(',') }),
    });
  }

  /** Канал події: належить акаунтові з підписаного вебхука, увімкнений і досі існує у провайдера */
  private async routeChannel(
    tx: Prisma.TransactionClient,
    account: { id: string; provider: string },
    channelExternalId: string,
  ): Promise<{ ok: true; channel: ChannelRow } | { ok: false; reason: string }> {
    const channel = await tx.channel.findFirst({
      where: { provider: account.provider, externalId: channelExternalId, providerMissingAt: null },
      select: { id: true, accountId: true, isEnabled: true, settings: true },
    });
    if (!channel) return { ok: false, reason: 'unknown_channel' };
    if (channel.accountId !== account.id) return { ok: false, reason: 'foreign_channel' };
    if (!channel.isEnabled) return { ok: false, reason: 'channel_disabled' };
    return { ok: true, channel };
  }

  private async finish(
    tx: Prisma.TransactionClient,
    eventId: string,
    outcome: IngestOutcome,
  ): Promise<IngestOutcome> {
    await tx.channelWebhookEvent.update({
      where: { id: eventId },
      data: {
        state: outcome.state === 'SKIPPED' ? 'PROCESSED' : outcome.state,
        processedAt: new Date(),
        error: outcome.error ?? null,
      },
    });
    return outcome;
  }

  /** Одне повідомлення → посилання на збережене або `null`, якщо це повтор уже збереженого */
  private async ingestMessage(
    tx: Prisma.TransactionClient,
    channel: ChannelRow,
    event: NormalizedMessageEvent,
  ): Promise<MessageRef | null> {
    const { contactId, created: contactCreated } = await this.contacts.resolveContact(
      tx,
      channel.id,
      event.from,
      {
        displayName: event.profileName,
        at: new Date(event.sentAt),
        // Вхідне від клієнта — згода на сервісні повідомлення (O-W9, рекомендація)
        optInSource: 'inbound_message',
      },
    );
    const sentAt = new Date(event.sentAt);
    const { id: conversationId, reopened } = await this.resolveConversation(
      tx,
      channel,
      contactId,
      sentAt,
    );

    // Рядок розмови блокується ДО перевірки дубліката: два паралельні опрацювання одного
    // повідомлення серіалізуються тут, і другий бачить уже закомічений рядок першого.
    // Тому дублікат не бере `seq` (дірка в нумерації ловилась би детектором дірок вічно)
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM conversations WHERE id = ${conversationId} FOR UPDATE`;

    const contact = await tx.channelContact.findUniqueOrThrow({
      where: { id: contactId },
      select: { displayName: true },
    });
    const addressLabel = event.from.value;
    // Імʼя з профілю, що приходить із цим самим повідомленням, головніше за збережене: контакт міг з'явитися
    // без імені (агент почав розмову з номера), і перше вхідне не має підписуватись номером
    const senderName = event.profileName ?? contact.displayName ?? addressLabel;
    const customerActor = { type: 'customer' as const, label: senderName };

    // Повернення розв'язаної розмови в роботу — подія робочого процесу, навіть якщо саме це
    // повідомлення виявиться повтором: розмова вже відкрита, і слід має лишитись
    if (reopened) {
      await this.workflow.recordStatusChange(tx, conversationId, 'RESOLVED', 'OPEN', customerActor);
    }

    const duplicate = await tx.chatMessage.findFirst({
      where: { channelId: channel.id, externalId: event.externalMessageId },
      select: { id: true },
    });
    if (duplicate) return null;

    // Клієнт відповів — «чекаємо на клієнта» закінчилось
    if (locked[0]?.status === 'PENDING') {
      await this.workflow.setStatus(tx, conversationId, 'OPEN', customerActor);
    }

    const body = event.content.body;

    const { lastSeq } = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastSeq: { increment: 1 },
        lastMessageAt: new Date(),
        lastMessagePreview: toPreview(body),
        customerLastMessageAt: sentAt,
      },
      select: { lastSeq: true },
    });

    const message = await tx.chatMessage.create({
      data: {
        conversationId,
        seq: lastSeq,
        kind: 'TEXT',
        visibility: 'PUBLIC',
        status: 'SENT',
        senderType: 'customer',
        senderLabel: senderName,
        body,
        direction: 'INBOUND',
        channelId: channel.id,
        externalId: event.externalMessageId,
        senderContactId: contactId,
        providerSentAt: sentAt,
        ...(event.content.unsupportedType !== undefined && {
          payload: { unsupported: { type: event.content.unsupportedType } },
        }),
        providerMeta: event.providerMeta as Prisma.InputJsonValue,
      },
    });

    await tx.channelContact.update({
      where: { id: contactId },
      data: {
        lastInboundAt: sentAt,
        // Профільне імʼя оновлюється, лише коли воно прийшло (порожнє не затирає відоме)
        ...(event.profileName ? { displayName: event.profileName } : {}),
      },
    });

    // Учасник клієнтської розмови — її відповідальний (design.md D7): непрочитане рахується лише йому
    await tx.conversationParticipant.updateMany({
      where: { conversationId, leftAt: null },
      data: { unreadCount: { increment: 1 } },
    });

    if (contactCreated) await this.contacts.autoLinkCustomer(tx, contactId, event.from.value);
    return { conversationId, messageId: message.id };
  }

  // -------------------------------------------------------------------------
  // Розмова клієнта: одна відкрита на контакт (design.md D6)
  // -------------------------------------------------------------------------

  private async resolveConversation(
    tx: Prisma.TransactionClient,
    channel: ChannelRow,
    contactId: string,
    sentAt: Date,
  ): Promise<{ id: string; reopened: boolean }> {
    const open = await tx.conversation.findFirst({
      where: { contactId, status: { not: 'RESOLVED' } },
      select: { id: true },
    });
    if (open) return { id: open.id, reopened: false };

    // Розв'язана розмова всередині вікна повертається в роботу замість нової
    const windowMs = reopenHours(channel.settings) * 3_600_000;
    const resolved = await tx.conversation.findFirst({
      where: { contactId, status: 'RESOLVED' },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, lastMessageAt: true },
    });
    if (
      resolved?.lastMessageAt &&
      sentAt.getTime() - resolved.lastMessageAt.getTime() <= windowMs
    ) {
      // Умовний UPDATE під індекс: якщо хтось уже відкрив іншу розмову цього контакта, частковий UNIQUE
      // не дасть — тоді береться та
      try {
        await tx.$executeRaw`SAVEPOINT reopen_conversation`;
        await tx.conversation.update({
          where: { id: resolved.id },
          data: { status: 'OPEN', resolvedAt: null },
        });
        await tx.$executeRaw`RELEASE SAVEPOINT reopen_conversation`;
        return { id: resolved.id, reopened: true };
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT reopen_conversation`;
        const winner = await tx.conversation.findFirst({
          where: { contactId, status: { not: 'RESOLVED' } },
          select: { id: true },
        });
        if (winner) return { id: winner.id, reopened: false };
        throw new Error(`Could not reopen conversation for contact ${contactId}`);
      }
    }

    const created = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO conversations (id, kind, access, channel_id, contact_id, updated_at)
      VALUES (gen_random_uuid()::text, 'CUSTOMER', 'tenant', ${channel.id}, ${contactId}, now())
      ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL AND status <> 'RESOLVED' DO NOTHING
      RETURNING id`;
    if (created[0]) return { id: created[0].id, reopened: false };

    const winner = await tx.conversation.findFirst({
      where: { contactId, status: { not: 'RESOLVED' } },
      select: { id: true },
    });
    if (!winner) throw new Error(`Conversation race for contact ${contactId}`);
    return { id: winner.id, reopened: false };
  }
}

function emptyOutcome(state: IngestOutcome['state']): IngestOutcome {
  return { stored: 0, changedConversationIds: [], storedMessages: [], updatedMessages: [], state };
}

function reopenHours(settings: unknown): number {
  const raw = (settings as { reopenHours?: unknown } | null)?.reopenHours;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_REOPEN_HOURS;
}
