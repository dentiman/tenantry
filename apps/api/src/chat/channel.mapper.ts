import type { Prisma } from '@saas-skeleton/database';
import type {
  AdminChannelResponse,
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
  // Для `deliveryReceipts`: квитанції приходять, поки номер підписаний на цю систему (CHAT-3b2)
  webhookSubscribedAt: true,
} satisfies Prisma.ChannelSelect;

export type ChannelRow = Prisma.ChannelGetPayload<{ select: typeof CHANNEL_SELECT }>;

/** Те, що адмін бачить про номер, синхронізований із провайдера (CHAT-3a) */
export const ADMIN_CHANNEL_SELECT = {
  ...CHANNEL_SELECT,
  qualityRating: true,
  accountMode: true,
  providerMeta: true,
  providerMissingAt: true,
} satisfies Prisma.ChannelSelect;

export type AdminChannelRow = Prisma.ChannelGetPayload<{ select: typeof ADMIN_CHANNEL_SELECT }>;

/**
 * Чи приходять квитанції доставки: fake — так (їх шле симулятор); справжній провайдер — лише з
 * підпискою НОМЕРА на цю систему (CHAT-3b2: час підписки — на каналі, його ставить і знімає адмін). Це дешевий
 * показник, а не істина; без квитанцій повідомлення не йде далі «прийнято» (CHAT-3a, design.md D10).
 */
export function hasDeliveryReceipts(provider: string, webhookSubscribedAt: Date | null): boolean {
  return provider === 'fake' || webhookSubscribedAt !== null;
}

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
    deliveryReceipts: hasDeliveryReceipts(channel.provider, channel.webhookSubscribedAt),
  };
}

export function toAdminChannelResponse(channel: AdminChannelRow): AdminChannelResponse {
  const meta = channel.providerMeta as { nameStatus?: unknown } | null;
  return {
    ...toChannelResponse(channel),
    qualityRating: channel.qualityRating,
    mode: channel.accountMode,
    nameStatus: typeof meta?.nameStatus === 'string' ? meta.nameStatus : null,
    isMissing: channel.providerMissingAt !== null,
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
  appId: string | null;
  verifyToken: string;
  webhookKey: string;
  tokenKind: string | null;
  tokenExpiresAt: Date | null;
  tokenCheckedAt: Date | null;
  scopes: string[];
  lastSyncAt: Date | null;
  lastError: string | null;
  channels: AdminChannelRow[];
}

function toToken(account: AccountRow, mask: string | null): MessagingAccountResponse['token'] {
  if (account.credentials === null || mask === null) return null;
  const kind =
    account.tokenKind === 'SYSTEM_USER' || account.tokenKind === 'USER'
      ? account.tokenKind
      : 'UNKNOWN';
  return {
    mask,
    kind,
    expiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    scopes: account.scopes,
    verified: kind !== 'UNKNOWN',
    checkedAt: account.tokenCheckedAt?.toISOString() ?? null,
  };
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
  /** Останні чотири символи токена, розшифрованого сервісом; `null` — токена немає */
  tokenMask: string | null,
): MessagingAccountResponse {
  return {
    id: account.id,
    provider: account.provider as MessagingAccountResponse['provider'],
    name: account.name,
    status: account.status,
    credentialsSet: account.credentials !== null,
    appSecretSet: account.appSecret !== null,
    appIdSet: account.appId !== null,
    token: toToken(account, tokenMask),
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    lastError: account.lastError,
    channels: account.channels.map(toAdminChannelResponse),
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
