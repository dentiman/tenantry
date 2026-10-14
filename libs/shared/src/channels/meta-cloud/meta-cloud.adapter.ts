import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelCredentials,
  ParseResult,
  RawWebhookRequest,
} from '../channel-adapter';
import { ChannelSendError, type OutboundContext } from '../channel-send';
import { classifyMetaError } from './errors';
import { MetaApiError, MetaGraphClient } from './graph-client';

/**
 * Адаптер WhatsApp Cloud API (CHAT-3a: лише вихід). Відправка тексту й схваленого шаблону за іменем;
 * успіх — 2xx із `messages[0].id` (поле `message_status` є лише в шаблону й не потрібне). Вебхуки —
 * CHAT-3b: до того методи вхідного шляху відмовляють, а не вгадують, тож випадковий запит на публічну
 * адресу акаунта не буде прийнятий за дійсний.
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

  verifyWebhook(_req: RawWebhookRequest, _creds: ChannelCredentials): boolean {
    return false;
  }

  handshake(): string | null {
    return null;
  }

  parseWebhook(): ParseResult {
    return { events: [], error: 'webhooks_not_enabled' };
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
}
