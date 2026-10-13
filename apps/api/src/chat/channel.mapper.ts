import type { Prisma } from '@saas-skeleton/database';
import type {
  ChannelContactResponse,
  ChannelResponse,
  InboxEntry,
  MessagingAccountResponse,
} from '@saas-skeleton/contracts';

/** Що читається про канал: без облікових даних і без налаштувань провайдера */
export const CHANNEL_SELECT = {
  id: true,
  type: true,
  provider: true,
  displayPhoneNumber: true,
  verifiedName: true,
  isEnabled: true,
  isDefault: true,
} satisfies Prisma.ChannelSelect;

export type ChannelRow = Prisma.ChannelGetPayload<{ select: typeof CHANNEL_SELECT }>;

export const INBOX_SELECT = {
  id: true,
  status: true,
  assigneeId: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  lastSeq: true,
  // Учасник клієнтської розмови — її відповідальний: звідси персональний лічильник (CHAT-2b)
  participants: { where: { leftAt: null }, select: { userId: true, unreadCount: true } },
  channel: { select: CHANNEL_SELECT },
  contact: {
    select: {
      id: true,
      displayName: true,
      customer: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ConversationSelect;

export type InboxRow = Prisma.ConversationGetPayload<{ select: typeof INBOX_SELECT }>;

export const CONTACT_SELECT = {
  id: true,
  channelId: true,
  displayName: true,
  lastInboundAt: true,
  customer: { select: { id: true, name: true } },
  addresses: { select: { kind: true, value: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ChannelContactSelect;

export type ContactRow = Prisma.ChannelContactGetPayload<{ select: typeof CONTACT_SELECT }>;

export function toChannelResponse(channel: ChannelRow): ChannelResponse {
  return {
    id: channel.id,
    type: channel.type,
    provider: channel.provider as ChannelResponse['provider'],
    displayPhoneNumber: channel.displayPhoneNumber,
    verifiedName: channel.verifiedName,
    isEnabled: channel.isEnabled,
    isDefault: channel.isDefault,
  };
}

/**
 * Рядок скриньки. `awaitingReply`: остання публічна репліка — клієнтська, а розмова ще відкрита.
 * `unreadCount` — лише відповідальному (він єдиний учасник, D7), для решти 0.
 */
export function toInboxEntry(
  row: InboxRow,
  lastMessageIsInbound: boolean,
  viewerId: string,
): InboxEntry | null {
  // Клієнтська розмова без каналу чи контакта — порушення інваріанта; у відповідь не віддаємо
  if (!row.channel || !row.contact) return null;
  return {
    id: row.id,
    status: row.status,
    channel: toChannelResponse(row.channel),
    contact: {
      id: row.contact.id,
      displayName: row.contact.displayName,
      customer: row.contact.customer,
    },
    assigneeId: row.assigneeId,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    awaitingReply: row.status !== 'RESOLVED' && lastMessageIsInbound,
    unreadCount: row.participants.find((p) => p.userId === viewerId)?.unreadCount ?? 0,
  };
}

export function toContactResponse(contact: ContactRow): ChannelContactResponse {
  return {
    id: contact.id,
    channelId: contact.channelId,
    displayName: contact.displayName,
    customer: contact.customer,
    addresses: contact.addresses.map((a) => ({
      kind: a.kind as ChannelContactResponse['addresses'][number]['kind'],
      value: a.value,
    })),
    lastInboundAt: contact.lastInboundAt?.toISOString() ?? null,
  };
}

export interface AccountRow {
  id: string;
  provider: string;
  name: string;
  status: MessagingAccountResponse['status'];
  credentials: string | null;
  appSecret: string | null;
  verifyToken: string;
  webhookKey: string;
  channels: ChannelRow[];
}

/** Облікові дані віддаються лише як «задано / ні» — у клартексті не повертаються ніколи */
export function toMessagingAccountResponse(
  account: AccountRow,
  webhook: {
    address: string | null;
    lastDeliveryAt: Date | null;
    last24h: MessagingAccountResponse['webhook']['last24h'];
  },
  includeSecrets: boolean,
): MessagingAccountResponse {
  return {
    id: account.id,
    provider: account.provider as MessagingAccountResponse['provider'],
    name: account.name,
    status: account.status,
    credentialsSet: account.credentials !== null,
    appSecretSet: account.appSecret !== null,
    channels: account.channels.map(toChannelResponse),
    webhook: {
      // Адреса й verify token — лише адміну (design.md D3a)
      address: includeSecrets ? webhook.address : null,
      verifyToken: includeSecrets ? account.verifyToken : null,
      signingSecretSet: account.appSecret !== null,
      lastDeliveryAt: webhook.lastDeliveryAt?.toISOString() ?? null,
      last24h: webhook.last24h,
    },
  };
}
