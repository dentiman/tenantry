import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import type { NormalizedMessageEvent } from '@saas-skeleton/contracts';
import { toPreview } from '../chat/preview';
import { NonRetryableMessageError } from '../messaging/messaging.errors';
import { ChannelAdapterRegistry } from './channel-adapter-registry';
import { phoneDigits, phoneLookupValues, normalizeE164 } from './phone';

/** Вікно, у межах якого вхідне повертає РОЗВ'ЯЗАНУ розмову у роботу (O-W4); `channels.settings.reopenHours` */
export const DEFAULT_REOPEN_HOURS = 24;

export interface IngestOutcome {
  /** Нових повідомлень збережено (дублікати й нерозібране не рахуються) */
  stored: number;
  /** Розмови, у яких щось змінилося: за ними браузер перечитує скриньку */
  changedConversationIds: string[];
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

  constructor(private readonly registry: ChannelAdapterRegistry) {}

  /** Розібрати збережений вебхук і застосувати його повідомлення; позначити стан рядка події */
  async ingestEvent(tx: Prisma.TransactionClient, eventId: string): Promise<IngestOutcome> {
    const event = await tx.channelWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      // Рядок видалено retention-кроном раніше за роботу — повторювати нема чого
      throw new NonRetryableMessageError(`Webhook event ${eventId} not found`);
    }
    if (event.state !== 'RECEIVED') {
      return { stored: 0, changedConversationIds: [], state: 'SKIPPED' };
    }

    const account = await tx.messagingAccount.findUnique({
      where: { id: event.accountId },
      select: { id: true, provider: true },
    });
    const adapter = account ? this.registry.get(account.provider) : undefined;
    if (!account || !adapter) {
      return this.finish(tx, eventId, { stored: 0, changedConversationIds: [], state: 'FAILED', error: 'no_adapter' });
    }

    const parsed = adapter.parseWebhook(Buffer.from(event.body, 'utf8'));
    if (parsed.error !== undefined) {
      return this.finish(tx, eventId, { stored: 0, changedConversationIds: [], state: 'FAILED', error: parsed.error });
    }

    const changed = new Set<string>();
    const unroutable: string[] = [];
    let stored = 0;

    for (const item of parsed.events) {
      if (item.kind !== 'message') continue;

      const channel = await tx.channel.findFirst({
        where: { provider: account.provider, externalId: item.channelExternalId, providerMissingAt: null },
        select: { id: true, accountId: true, isEnabled: true, settings: true },
      });
      if (!channel) {
        unroutable.push('unknown_channel');
        continue;
      }
      if (channel.accountId !== account.id) {
        unroutable.push('foreign_channel');
        continue;
      }
      if (!channel.isEnabled) {
        unroutable.push('channel_disabled');
        continue;
      }

      const conversationId = await this.ingestMessage(tx, channel, item);
      if (conversationId) {
        stored += 1;
        changed.add(conversationId);
      }
    }

    // Усе, що було повідомленнями, виявилось нероутованим — подія нічого не дала
    const onlyUnroutable = stored === 0 && changed.size === 0 && unroutable.length > 0;
    return this.finish(tx, eventId, {
      stored,
      changedConversationIds: [...changed],
      state: onlyUnroutable ? 'UNROUTABLE' : 'PROCESSED',
      ...(unroutable.length > 0 && { error: [...new Set(unroutable)].join(',') }),
    });
  }

  private async finish(
    tx: Prisma.TransactionClient,
    eventId: string,
    outcome: IngestOutcome,
  ): Promise<IngestOutcome> {
    await tx.channelWebhookEvent.update({
      where: { id: eventId },
      data: { state: outcome.state === 'SKIPPED' ? 'PROCESSED' : outcome.state, processedAt: new Date(), error: outcome.error ?? null },
    });
    return outcome;
  }

  /** Одне повідомлення → `conversationId` або `null`, якщо це повтор уже збереженого */
  private async ingestMessage(
    tx: Prisma.TransactionClient,
    channel: ChannelRow,
    event: NormalizedMessageEvent,
  ): Promise<string | null> {
    const { contactId, created: contactCreated } = await this.resolveContact(tx, channel.id, event);
    const sentAt = new Date(event.sentAt);
    const conversationId = await this.resolveConversation(tx, channel, contactId, sentAt);

    // Рядок розмови блокується ДО перевірки дубліката: два паралельні опрацювання одного
    // повідомлення серіалізуються тут, і другий бачить уже закомічений рядок першого.
    // Тому дублікат не бере `seq` (дірка в нумерації ловилась би детектором дірок вічно)
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;

    const duplicate = await tx.chatMessage.findFirst({
      where: { channelId: channel.id, externalId: event.externalMessageId },
      select: { id: true },
    });
    if (duplicate) return null;

    const contact = await tx.channelContact.findUniqueOrThrow({
      where: { id: contactId },
      select: { displayName: true },
    });
    const addressLabel = event.from.value;
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

    await tx.chatMessage.create({
      data: {
        conversationId,
        seq: lastSeq,
        kind: 'TEXT',
        visibility: 'PUBLIC',
        status: 'SENT',
        senderType: 'customer',
        senderLabel: contact.displayName ?? addressLabel,
        body,
        direction: 'INBOUND',
        channelId: channel.id,
        externalId: event.externalMessageId,
        senderContactId: contactId,
        providerSentAt: sentAt,
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

    if (contactCreated) await this.autoLinkCustomer(tx, contactId, event.from.value);
    return conversationId;
  }

  // -------------------------------------------------------------------------
  // Контакт і адреса (design.md D5)
  // -------------------------------------------------------------------------

  private async resolveContact(
    tx: Prisma.TransactionClient,
    channelId: string,
    event: NormalizedMessageEvent,
  ): Promise<{ contactId: string; created: boolean }> {
    const { kind, value } = event.from;
    const candidates = kind === 'phone' ? phoneLookupValues(value) : [value];

    const find = (): Promise<{ contactId: string } | null> =>
      tx.channelContactAddress.findFirst({
        where: {
          channelId,
          kind,
          OR: [{ value: { in: candidates } }, { normalized: { in: candidates } }],
        },
        select: { contactId: true },
      });

    const existing = await find();
    if (existing) return { contactId: existing.contactId, created: false };

    // Контакт створюється першим, адреса — `ON CONFLICT DO NOTHING`: у транзакції Postgres
    // помилка унікальності відмінила б усе, а так програвший паралельної гонки просто
    // бачить 0 рядків, прибирає свій контакт і бере переможця
    const contact = await tx.channelContact.create({
      data: {
        channelId,
        displayName: event.profileName,
        // Вхідне від клієнта — згода на сервісні повідомлення (O-W9, рекомендація);
        // маркетингова згода — окремий запис і сюди не потрапляє
        optInAt: new Date(event.sentAt),
        optInSource: 'inbound_message',
        lastInboundAt: new Date(event.sentAt),
      },
      select: { id: true },
    });
    const normalized = kind === 'phone' ? normalizeE164(value) : null;
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO channel_contact_addresses (id, contact_id, channel_id, kind, value, normalized)
      VALUES (gen_random_uuid()::text, ${contact.id}, ${channelId}, ${kind}, ${value}, ${normalized})
      ON CONFLICT (channel_id, kind, value) DO NOTHING
      RETURNING id`;
    if (inserted.length > 0) return { contactId: contact.id, created: true };

    await tx.channelContact.delete({ where: { id: contact.id } });
    const winner = await find();
    if (!winner) {
      // Адресу вставив інший, але вже відкотив: нехай job повториться
      throw new Error(`Contact address race for channel ${channelId}`);
    }
    return { contactId: winner.contactId, created: false };
  }

  /** Привʼязка лише коли номер належить РІВНО одному клієнтові тенанта (клієнт або його контактна особа) */
  private async autoLinkCustomer(
    tx: Prisma.TransactionClient,
    contactId: string,
    rawPhone: string,
  ): Promise<void> {
    const digits = phoneDigits(rawPhone);
    if (digits.length < 5) return;

    const matches = await tx.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
        FROM customers c
        LEFT JOIN customer_contacts cc ON cc.customer_id = c.id
       WHERE regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') = ${digits}
          OR regexp_replace(coalesce(cc.phone, ''), '\\D', '', 'g') = ${digits}`;
    const [only, ...rest] = matches;
    if (only && rest.length === 0) {
      await tx.channelContact.update({ where: { id: contactId }, data: { customerId: only.id } });
    }
  }

  // -------------------------------------------------------------------------
  // Розмова клієнта: одна відкрита на контакт (design.md D6)
  // -------------------------------------------------------------------------

  private async resolveConversation(
    tx: Prisma.TransactionClient,
    channel: ChannelRow,
    contactId: string,
    sentAt: Date,
  ): Promise<string> {
    const open = await tx.conversation.findFirst({
      where: { contactId, status: { not: 'RESOLVED' } },
      select: { id: true },
    });
    if (open) return open.id;

    // Розв'язана розмова всередині вікна повертається в роботу замість нової
    const windowMs = reopenHours(channel.settings) * 3_600_000;
    const resolved = await tx.conversation.findFirst({
      where: { contactId, status: 'RESOLVED' },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, lastMessageAt: true },
    });
    if (resolved?.lastMessageAt && sentAt.getTime() - resolved.lastMessageAt.getTime() <= windowMs) {
      // Умовний UPDATE під індекс: якщо хтось уже відкрив іншу розмову цього контакта, частковий UNIQUE
      // не дасть — тоді береться та
      try {
        await tx.$executeRaw`SAVEPOINT reopen_conversation`;
        await tx.conversation.update({
          where: { id: resolved.id },
          data: { status: 'OPEN', resolvedAt: null },
        });
        await tx.$executeRaw`RELEASE SAVEPOINT reopen_conversation`;
        return resolved.id;
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT reopen_conversation`;
        const winner = await tx.conversation.findFirst({
          where: { contactId, status: { not: 'RESOLVED' } },
          select: { id: true },
        });
        if (winner) return winner.id;
        throw new Error(`Could not reopen conversation for contact ${contactId}`);
      }
    }

    const created = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO conversations (id, kind, access, channel_id, contact_id, updated_at)
      VALUES (gen_random_uuid()::text, 'CUSTOMER', 'tenant', ${channel.id}, ${contactId}, now())
      ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL AND status <> 'RESOLVED' DO NOTHING
      RETURNING id`;
    if (created[0]) return created[0].id;

    const winner = await tx.conversation.findFirst({
      where: { contactId, status: { not: 'RESOLVED' } },
      select: { id: true },
    });
    if (!winner) throw new Error(`Conversation race for contact ${contactId}`);
    return winner.id;
  }
}

function reopenHours(settings: unknown): number {
  const raw = (settings as { reopenHours?: unknown } | null)?.reopenHours;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_REOPEN_HOURS;
}
