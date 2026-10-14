import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import { normalizeE164, phoneDigits, phoneLookupValues } from './phone';

export interface ContactAddressInput {
  kind: 'phone' | 'bsuid' | 'parent_bsuid';
  value: string;
}

/**
 * Контакт каналу, його адреса, автопривʼязка до клієнта й відкрита розмова (CHAT-3a, design.md D9):
 * спільне для ingest вхідного і для «агент починає розмову з номера». Раніше лежало приватним у
 * `ChannelIngestService`; перенесено без зміни поведінки — той самий набір тестів ingest лишається
 * контрольним. Усе в ТРАНЗАКЦІЇ викликача (`tx` першим аргументом).
 *
 * Інваріанти: адреса — `ON CONFLICT DO NOTHING` (програвший гонки бере переможця); клієнт
 * привʼязується лише коли номер належить РІВНО одному, і лише для НОВОГО контакта; жодного
 * автостворення клієнта.
 */
@Injectable()
export class ChannelContactService {
  async resolveContact(
    tx: Prisma.TransactionClient,
    channelId: string,
    address: ContactAddressInput,
    options: { displayName: string | null; at: Date; optInSource: string },
  ): Promise<{ contactId: string; created: boolean }> {
    const { kind, value } = address;
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
        displayName: options.displayName,
        // Звернення клієнта — згода на сервісні повідомлення (O-W9, рекомендація); для розмови, яку
        // починає агент, згоди ще немає, тому там `optInAt` не виставляється (нижче)
        ...(options.optInSource === 'inbound_message'
          ? { optInAt: options.at, optInSource: options.optInSource, lastInboundAt: options.at }
          : {}),
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
      // Адресу вставив інший, але вже відкотив: нехай виклик повториться
      throw new Error(`Contact address race for channel ${channelId}`);
    }
    return { contactId: winner.contactId, created: false };
  }

  /** Привʼязка лише коли номер належить РІВНО одному клієнтові тенанта (клієнт або його контактна особа) */
  async autoLinkCustomer(
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

  /**
   * Відкрита розмова контакта або нова порожня (CHAT-3a, chat/outreach). Одна відкрита на контакт —
   * частковий UNIQUE, тож дві одночасні спроби дають одну розмову. Розв'язана не відкривається знову: агент
   * починає НОВУ розмову (на відміну від вхідного, яке в межах вікна повертає стару).
   */
  async openConversation(
    tx: Prisma.TransactionClient,
    channelId: string,
    contactId: string,
  ): Promise<{ id: string; created: boolean }> {
    const created = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO conversations (id, kind, access, channel_id, contact_id, updated_at)
      VALUES (gen_random_uuid()::text, 'CUSTOMER', 'tenant', ${channelId}, ${contactId}, now())
      ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL AND status <> 'RESOLVED' DO NOTHING
      RETURNING id`;
    if (created[0]) return { id: created[0].id, created: true };

    const winner = await tx.conversation.findFirst({
      where: { contactId, status: { not: 'RESOLVED' } },
      select: { id: true },
    });
    if (!winner) throw new Error(`Conversation race for contact ${contactId}`);
    return { id: winner.id, created: false };
  }
}
