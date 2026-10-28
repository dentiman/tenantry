import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelCredentials,
  ParseResult,
  RawWebhookRequest,
  ReadReceiptContext,
} from '../channel-adapter';
import { ChannelSendError, type OutboundContext } from '../channel-send';
import { classifyMetaError } from './errors';
import { MetaApiError, MetaGraphClient } from './graph-client';
import { parseMetaWebhook } from './webhook-parser';

/**
 * Адаптер WhatsApp Cloud API (CHAT-3a: лише вихід). Відправка тексту й схваленого шаблону за іменем;
 * успіх — 2xx із `messages[0].id` (поле `message_status` є лише в шаблону й не потрібне). Вебхуки
 * (CHAT-3b1/3b2): рукостискання, підпис і розбір повідомлень та квитанцій у події ядра.
 *
 * Відповідь 2xx означає «прийнято», а не «доставлено» (docs/whatsapp-research/live-probe-2026-10-13.md п.1).
 */
export class MetaCloudAdapter implements ChannelAdapter {
  readonly provider = 'meta_cloud' as const;
  readonly type = 'WHATSAPP' as const;
  readonly capabilities: ChannelCapabilities = {
    freeformWindowHours: 24,
    maxTextLength: 4096,
    templates: true,
    // Вікно відкриває вхідне, а вхідних у цьому зрізі немає: вирішує Meta (design.md D6)
    windowEnforcement: 'provider',
  };

  constructor(private readonly client: MetaGraphClient = new MetaGraphClient()) {}

  /**
   * `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(app secret, сирі байти). Перевірено на 215 справжніх
   * хуках legacy-dev: збіглись усі. Старий `X-Hub-Signature` (sha1) ігноруємо.
   */
  verifyWebhook(req: RawWebhookRequest, creds: ChannelCredentials): boolean {
    const header = req.headers['x-hub-signature-256'];
    if (!creds.appSecret || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', creds.appSecret).update(req.body).digest();
    const given = Buffer.from(header.slice('sha256='.length), 'hex');
    // timingSafeEqual кидає на різну довжину; нечитабельний hex дає коротший буфер
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** GET-рукостискання Meta: `hub.mode=subscribe` і наш verify token → відлуння `hub.challenge` */
  handshake(
    query: Readonly<Record<string, string | undefined>>,
    creds: ChannelCredentials,
  ): string | null {
    if (query['hub.mode'] !== 'subscribe') return null;
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!token || !challenge || token !== creds.verifyToken) return null;
    return challenge;
  }

  /** Тіло вебхука → події (CHAT-3b2); розбір — `webhook-parser.ts` */
  parseWebhook(raw: Buffer): ParseResult {
    return parseMetaWebhook(raw);
  }

  async send(ctx: OutboundContext, creds: ChannelCredentials): Promise<{ externalId: string }> {
    if (!creds.accessToken) {
      throw new ChannelSendError('AUTH', 'no_credentials', 'The account has no access token');
    }

    const common = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Формат провайдера: цифри з кодом країни, без плюса
      to: ctx.to.value.replace(/\D/g, ''),
      // Наш id повідомлення: за ним CHAT-3b зіставить квитанцію, що випередила запис external_id.
      // Місце поля в тілі не підтверджене документацією — перевіряється живою пробою (tasks 11.2)
      biz_opaque_callback_data: ctx.messageId,
    };
    const body = ctx.template
      ? {
          ...common,
          type: 'template',
          template: { name: ctx.template.name, language: { code: ctx.template.language } },
        }
      : { ...common, type: 'text', text: { body: ctx.body, preview_url: false } };

    try {
      const response = await this.client.request<{ messages?: { id?: unknown }[] }>({
        method: 'POST',
        path: `${ctx.channelExternalId}/messages`,
        body,
        token: creds.accessToken,
        operation: 'send',
        signal: ctx.signal,
      });
      const id = response.body.messages?.[0]?.id;
      if (typeof id !== 'string' || id === '') {
        // Невідомо, чи прийнято: повтор піде існуючим шляхом «непідтвердженої доставки»
        throw new ChannelSendError(
          'TRANSIENT',
          'no_message_id',
          'The provider answered without a message id',
          undefined,
          response.status,
        );
      }
      return { externalId: id };
    } catch (error) {
      if (error instanceof MetaApiError) throw classifyMetaError(error);
      throw error;
    }
  }

  /**
   * Прочитане агентом (CHAT-3b3): `status: "read"` з id вхідного; Meta відзначає й попередні. Помилку
   * (`131009` для повідомлення старше 30 днів, `190`, мережа) віддаємо як є: викликач її лише логує.
   */
  async markRead(ctx: ReadReceiptContext, creds: ChannelCredentials): Promise<void> {
    if (!creds.accessToken) {
      throw new ChannelSendError('AUTH', 'no_credentials', 'The account has no access token');
    }
    await this.client.request({
      method: 'POST',
      path: `${ctx.channelExternalId}/messages`,
      body: { messaging_product: 'whatsapp', status: 'read', message_id: ctx.externalMessageId },
      token: creds.accessToken,
      operation: 'read',
      signal: ctx.signal,
    });
  }
}
