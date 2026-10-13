import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';
import { ConversationStatusSchema } from './chat.schema';

/**
 * Контракти каналів зв'язку з клієнтами (CHAT-2a). Модель — docs/whatsapp-channel.md §4.1;
 * вимоги — openspec/changes/chat-2a-channel-inbound/specs.
 *
 * Провайдеронейтральні: `provider` стоїть окремо від `type`, а все провайдерське живе
 * в `providerMeta`, якого ядро не читає (§4.2).
 */

export const ChannelTypeSchema = z.enum(['WHATSAPP']);

/** `fake` — лише розробка й тести; `meta_cloud` додасть CHAT-3a; `twilio` — можливий пізніше */
export const ChannelProviderSchema = z.enum(['fake', 'meta_cloud']);

export const MessagingAccountStatusSchema = z.enum(['CONNECTED', 'NEEDS_REAUTH', 'DISABLED']);

export const WebhookEventStateSchema = z.enum(['RECEIVED', 'PROCESSED', 'FAILED', 'UNROUTABLE']);

/** Як контакт названий у провайдера: телефон або (пізніше) BSUID (docs/whatsapp-channel.md §4.6) */
export const ContactAddressKindSchema = z.enum(['phone', 'bsuid', 'parent_bsuid']);

/**
 * Подія, нормалізована адаптером з тіла вебхука: єдина форма, яку бачить ядро.
 * Дискримінований union — нова форма, якої ядро ще не вміє, не вигадується, а
 * зберігається як `unsupported` (нічого не відкидаємо мовчки). Інші види
 * (`status`, `template-status`, `identity-change`…) додає фаза, що їх споживає.
 */
export const NormalizedMessageEventSchema = z.object({
  kind: z.literal('message'),
  /** Ідентифікатор повідомлення в провайдера — арбітр дедупа */
  externalMessageId: z.string().min(1),
  /** Ідентифікатор каналу-отримувача в провайдера (WhatsApp: phone_number_id) */
  channelExternalId: z.string().min(1),
  from: z.object({
    kind: ContactAddressKindSchema,
    value: z.string().min(1),
  }),
  /** Профільне імʼя відправника, якщо провайдер його віддав */
  profileName: z.string().nullable(),
  /** Час повідомлення в провайдера */
  sentAt: z.iso.datetime(),
  content: z.object({ type: z.literal('text'), body: z.string() }),
  providerMeta: z.record(z.string(), z.unknown()),
});

export const NormalizedUnsupportedEventSchema = z.object({
  kind: z.literal('unsupported'),
  channelExternalId: z.string().nullable(),
  reason: z.string(),
  providerMeta: z.record(z.string(), z.unknown()),
});

export const NormalizedEventSchema = z.discriminatedUnion('kind', [
  NormalizedMessageEventSchema,
  NormalizedUnsupportedEventSchema,
]);

// ---------------------------------------------------------------------------
// Акаунт і канали
// ---------------------------------------------------------------------------

/**
 * Блок «Вебхук» акаунта (design.md D3a). Адресу і verify token бачить лише адмін; без
 * налаштованої публічної бази адреса `null` («недоступна»), а не вгадана.
 */
export const MessagingWebhookBlockSchema = z.object({
  address: z.string().nullable(),
  verifyToken: z.string().nullable(),
  signingSecretSet: z.boolean(),
  lastDeliveryAt: z.iso.datetime().nullable(),
  /** За останню добу, за станом події; `unroutable` — це стан UNROUTABLE у таблиці подій */
  last24h: z.object({
    received: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unroutable: z.number().int().nonnegative(),
  }),
});

export const ChannelResponseSchema = z.object({
  id: z.uuid(),
  type: ChannelTypeSchema,
  provider: ChannelProviderSchema,
  displayPhoneNumber: z.string().nullable(),
  verifiedName: z.string().nullable(),
  isEnabled: z.boolean(),
  isDefault: z.boolean(),
});

/** Облікові дані в клартексті не повертаються ніколи: лише «задано / ні» */
export const MessagingAccountResponseSchema = z.object({
  id: z.uuid(),
  provider: ChannelProviderSchema,
  name: z.string(),
  status: MessagingAccountStatusSchema,
  credentialsSet: z.boolean(),
  appSecretSet: z.boolean(),
  channels: z.array(ChannelResponseSchema),
  webhook: MessagingWebhookBlockSchema,
});

export const MessagingAccountListResponseSchema = z.object({
  items: z.array(MessagingAccountResponseSchema),
});

export const ChannelListResponseSchema = z.object({ items: z.array(ChannelResponseSchema) });

/** Відповідь dev-дії: адреса й секрет підпису для симулятора (лише коли `CHAT_DEV_TOOLS`) */
export const FakeChannelSetupResponseSchema = z.object({
  account: MessagingAccountResponseSchema,
  signingSecret: z.string(),
});

// ---------------------------------------------------------------------------
// Контакт, привʼязка, скринька
// ---------------------------------------------------------------------------

export const ChannelContactCustomerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const ChannelContactAddressResponseSchema = z.object({
  kind: ContactAddressKindSchema,
  value: z.string(),
});

export const ChannelContactResponseSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  displayName: z.string().nullable(),
  customer: ChannelContactCustomerSchema.nullable(),
  addresses: z.array(ChannelContactAddressResponseSchema),
  lastInboundAt: z.iso.datetime().nullable(),
});

export const LinkContactCustomerSchema = z.object({
  customerId: z.uuid(),
});

/** Скринька клієнтських розмов: «мої» = призначені мені, «нерозібрані» = без виконавця */
export const InboxFilterSchema = z.enum(['mine', 'unassigned', 'all']);

export const InboxQuerySchema = CursorQuerySchema.extend({
  filter: InboxFilterSchema.default('all'),
});

export const InboxEntrySchema = z.object({
  id: z.uuid(),
  status: ConversationStatusSchema,
  channel: ChannelResponseSchema,
  contact: z.object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    customer: ChannelContactCustomerSchema.nullable(),
  }),
  assigneeId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime().nullable(),
  lastMessagePreview: z.string().nullable(),
  /**
   * Остання репліка — клієнтська й ще чекає на відповідь. Особистих лічильників
   * непрочитаного в спільній скриньці немає: курсор з'являється з призначенням (CHAT-2b).
   */
  awaitingReply: z.boolean(),
});

export const InboxListResponseSchema = cursorResponseSchema(InboxEntrySchema);

// ---------------------------------------------------------------------------
// Dev-симулятор
// ---------------------------------------------------------------------------

export const SimulateInboundSchema = z.object({
  /** Номер відправника, E.164 з плюсом або без */
  from: z.string().trim().min(5).max(32),
  text: z.string().trim().min(1).max(4000),
  profileName: z.string().trim().max(120).optional(),
  /** Той самий id двічі = повтор доставки (перевірка дедупа) */
  externalMessageId: z.string().trim().min(1).max(128).optional(),
});

export const SimulateInboundResponseSchema = z.object({
  externalMessageId: z.string(),
  /** Статус відповіді вебхука; 200 — прийнято */
  webhookStatus: z.number().int(),
});

export type ChannelType = z.infer<typeof ChannelTypeSchema>;
export type ChannelProvider = z.infer<typeof ChannelProviderSchema>;
export type MessagingAccountStatus = z.infer<typeof MessagingAccountStatusSchema>;
export type WebhookEventState = z.infer<typeof WebhookEventStateSchema>;
export type ContactAddressKind = z.infer<typeof ContactAddressKindSchema>;
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type NormalizedMessageEvent = z.infer<typeof NormalizedMessageEventSchema>;
export type MessagingWebhookBlock = z.infer<typeof MessagingWebhookBlockSchema>;
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
export type MessagingAccountResponse = z.infer<typeof MessagingAccountResponseSchema>;
export type ChannelContactResponse = z.infer<typeof ChannelContactResponseSchema>;
export type LinkContactCustomer = z.infer<typeof LinkContactCustomerSchema>;
export type InboxFilter = z.infer<typeof InboxFilterSchema>;
export type InboxQuery = z.infer<typeof InboxQuerySchema>;
export type InboxEntry = z.infer<typeof InboxEntrySchema>;
export type SimulateInbound = z.infer<typeof SimulateInboundSchema>;
export type InboxListResponse = z.infer<typeof InboxListResponseSchema>;
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;
export type MessagingAccountListResponse = z.infer<typeof MessagingAccountListResponseSchema>;
export type FakeChannelSetupResponse = z.infer<typeof FakeChannelSetupResponseSchema>;
export type SimulateInboundResponse = z.infer<typeof SimulateInboundResponseSchema>;
