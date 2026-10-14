import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';

/**
 * Контракти підключення WhatsApp Business і виходу (CHAT-3a, openspec/changes/chat-3a-whatsapp-send).
 * Облікові дані НІКОЛИ не є полем відповіді: лише маска останніх чотирьох символів і перевірені
 * властивості токена.
 */

const DigitsSchema = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, { error: 'digits' });

/** Пара «app id + секрет» — або обидва, або жодного: окремо вони не дають debug_token */
const appPairRule = (value: {
  appId?: string | undefined;
  appSecret?: string | undefined;
}): boolean => (value.appId === undefined) === (value.appSecret === undefined);

const appPairError = {
  error: 'The application id and the application secret go together',
  path: ['appSecret'],
};

const ConnectBase = z.object({
  provider: z.literal('meta_cloud'),
  /** WABA id (WhatsApp Manager / Business settings) */
  wabaId: DigitsSchema,
  /** Токен системного користувача (або тимчасовий) */
  accessToken: z.string().trim().min(20).max(2048),
  appId: DigitsSchema.optional(),
  appSecret: z.string().trim().min(16).max(128).optional(),
});

export const ConnectMessagingAccountSchema = ConnectBase.refine(appPairRule, appPairError);

export const UpdateAccountCredentialsSchema = z
  .object({
    accessToken: ConnectBase.shape.accessToken,
    appId: ConnectBase.shape.appId,
    appSecret: ConnectBase.shape.appSecret,
  })
  .refine(appPairRule, appPairError);

export const UpdateChannelSchema = z
  .object({ isEnabled: z.boolean().optional(), isDefault: z.boolean().optional() })
  .refine((value) => value.isEnabled !== undefined || value.isDefault !== undefined, {
    error: 'Nothing to update',
  });

/** Що провайдер підтвердив про токен; `verified = false` — не було чим перевірити (без app secret) */
export const AccountTokenSchema = z.object({
  /** Останні чотири символи; сам токен не повертається ніколи */
  mask: z.string(),
  kind: z.enum(['SYSTEM_USER', 'USER', 'UNKNOWN']),
  /** `null` — безстроковий (або невідомо, якщо `verified = false`) */
  expiresAt: z.iso.datetime().nullable(),
  scopes: z.array(z.string()),
  verified: z.boolean(),
  checkedAt: z.iso.datetime().nullable(),
});

export const SyncResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  /** Номери, яких не додано, і чому (`other_tenant`) */
  skipped: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});

export const ChannelLogEntrySchema = z.object({
  id: z.uuid(),
  operation: z.enum(['verify', 'sync', 'send', 'webhook', 'read']),
  ok: z.boolean(),
  httpStatus: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorTitle: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  messageId: z.uuid().nullable(),
  /** Лише білий список ключів (endpoint, recipientLast4, providerMessageId, pages, numbers) */
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const ChannelLogQuerySchema = CursorQuerySchema;
export const ChannelLogListResponseSchema = cursorResponseSchema(ChannelLogEntrySchema);

/** Де зараз доставляються вебхуки номера (CHAT-3b1, chat/webhook-subscription). Лише хости: чужі адреси можуть нести секрет */
export const WebhookLevelSchema = z.enum(['phone_number', 'whatsapp_business_account', 'application']);

export const WebhookStatusSchema = z.object({
  /** `ours` — діюче призначення збігається з адресою цього акаунта; `none` — ніхто; `elsewhere` — інший хост */
  state: z.enum(['ours', 'none', 'elsewhere']),
  /** Рівень, що діє (перший наявний: номер → WABA → застосунок) */
  level: WebhookLevelSchema.nullable(),
  /** Хост діючого призначення (для `ours` — наш) */
  host: z.string().nullable(),
  configured: z.object({
    phoneNumber: z.string().nullable(),
    whatsappBusinessAccount: z.string().nullable(),
    application: z.string().nullable(),
  }),
  /** Наша адреса для цього акаунта; `null` — публічну базу не налаштовано */
  address: z.string().nullable(),
  subscribedAt: z.iso.datetime().nullable(),
});

/** Підписати номер; `replaceHost` — хост, чиї події забираємо (обовʼязковий, якщо вони зараз ідуть деінде) */
export const SubscribeWebhookSchema = z.object({
  replaceHost: z.string().trim().min(1).max(255).optional(),
});

/** Захоплений вебхук як збережено (CHAT-3b1, chat/webhook-events); адмін-доступ — у тілі є номери й імена клієнтів */
export const WebhookEventSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  state: z.enum(['RECEIVED', 'PROCESSED', 'FAILED', 'UNROUTABLE', 'SKIPPED']),
  error: z.string().nullable(),
  /** `null` — нічим було перевірити (немає app secret) */
  signatureValid: z.boolean().nullable(),
  headers: z.record(z.string(), z.string()),
  /** Тіло байт-в-байт як прийшло */
  body: z.string(),
});

export const WebhookEventsQuerySchema = CursorQuerySchema;
export const WebhookEventListResponseSchema = cursorResponseSchema(WebhookEventSchema);

/** Агент починає розмову з номера (CHAT-3a, chat/outreach) */
export const StartConversationSchema = z.object({
  channelId: z.uuid(),
  /** E.164 з плюсом або без; нормалізується на сервері */
  phone: z.string().trim().min(5).max(32),
  name: z.string().trim().min(1).max(120).optional(),
});

/** Схвалений шаблон за іменем і мовою; змінні — CHAT-3c */
export const PostTemplateMessageSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, { error: 'template_name' }),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/, { error: 'template_language' }),
  clientMessageId: z.uuid(),
});

/** Коди `fieldErrors` вердикту провайдера при підключенні — їх перекладає UI */
export const CONNECTION_FIELD_CODES = [
  'token_invalid',
  'token_missing_scope',
  'token_wrong_app',
  'waba_no_access',
  'app_secret_invalid',
] as const;

export type ConnectMessagingAccount = z.infer<typeof ConnectMessagingAccountSchema>;
export type UpdateAccountCredentials = z.infer<typeof UpdateAccountCredentialsSchema>;
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;
export type AccountToken = z.infer<typeof AccountTokenSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type ChannelLogEntry = z.infer<typeof ChannelLogEntrySchema>;
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;
export type SubscribeWebhook = z.infer<typeof SubscribeWebhookSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type StartConversation = z.infer<typeof StartConversationSchema>;
export type PostTemplateMessage = z.infer<typeof PostTemplateMessageSchema>;
