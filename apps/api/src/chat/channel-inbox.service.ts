import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { ChannelContactResponse, CursorQuery, InboxFilter } from '@saas-skeleton/contracts';
import { normalizeE164 } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { CustomersService } from '../customers/customers.service';
import {
  CHANNEL_SELECT,
  CONTACT_SELECT,
  INBOX_SELECT,
  toContactResponse,
  toInboxEntry,
  type ChannelRow,
} from './channel.mapper';
import type { InboxEntry } from '@saas-skeleton/contracts';

/** Курсор скриньки — той самий формат, що в списку внутрішніх розмов: base64url("{lastMessageAt}|{id}") */
function encodeCursor(lastMessageAt: Date | null, id: string): string {
  return Buffer.from(`${lastMessageAt?.toISOString() ?? ''}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(at.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id };
}

/**
 * Скринька клієнтських розмов і контакти каналів (CHAT-2a; docs/whatsapp-channel.md §4.6–4.7).
 * Видимість розмов — не тут, а в `ConversationAccessService` (гілка `tenant`): скринька лише
 * ВИБИРАЄ клієнтські розмови поточного тенанта (межу тримає RLS).
 */
@Injectable()
export class ChannelInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  async listInbox(
    actor: JwtPayload,
    query: CursorQuery & { filter: InboxFilter },
  ): Promise<{ items: InboxEntry[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.conversation.findMany({
      where: {
        kind: 'CUSTOMER',
        contactId: { not: null },
        ...(query.filter === 'mine' && { assigneeId: actor.sub }),
        ...(query.filter === 'unassigned' && { assigneeId: null }),
        ...(cursor && {
          OR: [
            { lastMessageAt: { lt: cursor.at } },
            { lastMessageAt: cursor.at, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: query.limit + 1,
      select: INBOX_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    // «Чекає відповіді»: остання ПУБЛІЧНА текстова репліка розмови клієнтська. Системні записи
    // (призначення, статус) і нотатки теж беруть `seq`, тож «остання за seq» тут не годиться
    // (CHAT-2b). Два запити на сторінку, а не по запиту на рядок: максимум seq по розмовах, потім
    // самі рядки
    const latest = await this.prisma.chatMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: page.map((row) => row.id) },
        kind: 'TEXT',
        visibility: 'PUBLIC',
      },
      _max: { seq: true },
    });
    const lastMessages =
      latest.length === 0
        ? []
        : await this.prisma.chatMessage.findMany({
            where: {
              OR: latest.map((row) => ({ conversationId: row.conversationId, seq: row._max.seq ?? 0 })),
            },
            select: { conversationId: true, direction: true },
          });
    const inbound = new Set(
      lastMessages.filter((m) => m.direction === 'INBOUND').map((m) => m.conversationId),
    );

    const items = page
      .map((row) => toInboxEntry(row, inbound.has(row.id), actor.sub))
      .filter((entry): entry is InboxEntry => entry !== null);
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    };
  }

  listChannels(): Promise<ChannelRow[]> {
    return this.prisma.channel.findMany({
      where: { providerMissingAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: CHANNEL_SELECT,
    });
  }

  async getContact(contactId: string): Promise<ChannelContactResponse> {
    const contact = await this.prisma.channelContact.findUnique({
      where: { id: contactId },
      select: CONTACT_SELECT,
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return toContactResponse(contact);
  }

  /**
   * Привʼязка контакта до наявного клієнта. Умовний UPDATE (`customerId IS NULL`) — арбітр
   * гонки двох вкладок: програвший отримує 409, а не мовчки перезаписує привʼязку іншого.
   */
  async linkCustomer(contactId: string, customerId: string): Promise<ChannelContactResponse> {
    // Клієнта іншого тенанта RLS не покаже → той самий 404, що й для неіснуючого
    const customer = await this.customers.findOne(customerId);
    await this.assertContactExists(contactId);

    const { count } = await this.prisma.channelContact.updateMany({
      where: { id: contactId, customerId: null },
      data: { customerId: customer.id },
    });
    if (count === 0) {
      throw new ConflictException('Contact is already linked to a customer');
    }
    return this.getContact(contactId);
  }

  async unlinkCustomer(contactId: string): Promise<ChannelContactResponse> {
    await this.assertContactExists(contactId);
    await this.prisma.channelContact.update({
      where: { id: contactId },
      data: { customerId: null },
    });
    return this.getContact(contactId);
  }

  /**
   * Створити клієнта з контакта (імʼя й телефон з розмови) і привʼязати. Клієнта створює
   * ЕКСПОРТОВАНИЙ сервіс модуля customers (нумерація, активність, сповіщення), а не запис у його
   * таблицю. Це два кроки (власні транзакції): якщо між ними контакт устигли привʼязати іншою
   * дією, повертається 409, а створений клієнт лишається звичайним клієнтом без розмов.
   */
  async createCustomerFromContact(
    actor: JwtPayload,
    contactId: string,
  ): Promise<ChannelContactResponse> {
    const contact = await this.prisma.channelContact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        displayName: true,
        customerId: true,
        addresses: { select: { kind: true, value: true, normalized: true } },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.customerId) throw new ConflictException('Contact is already linked to a customer');

    const phone = contact.addresses.find((a) => a.kind === 'phone');
    const e164 = phone ? (phone.normalized ?? normalizeE164(phone.value)) : null;
    const trimmed = contact.displayName?.trim();
    const displayName = trimmed === '' ? undefined : trimmed;
    const name = displayName ?? phone?.value ?? 'WhatsApp contact';

    const customer = await this.customers.create({ name, ...(e164 && { phone: e164 }) }, actor);

    const { count } = await this.prisma.channelContact.updateMany({
      where: { id: contactId, customerId: null },
      data: { customerId: customer.id },
    });
    if (count === 0) {
      throw new ConflictException('Contact was linked to another customer in the meantime');
    }
    return this.getContact(contactId);
  }

  private async assertContactExists(contactId: string): Promise<void> {
    const exists = await this.prisma.channelContact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Contact not found');
  }
}
