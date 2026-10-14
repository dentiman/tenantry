import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { SubscribeWebhook, WebhookStatus } from '@saas-skeleton/contracts';
import { ChannelLogService, CryptoService, MetaApiError, MetaGraphClient } from '@saas-skeleton/shared';
import { MessagingAccountService } from './messaging-account.service';

interface WebhookConfiguration {
  phone_number?: unknown;
  whatsapp_business_account?: unknown;
  application?: unknown;
}

interface LoadedChannel {
  id: string;
  accountId: string;
  externalId: string;
  webhookSubscribedAt: Date | null;
  token: string;
  verifyToken: string;
  address: string | null;
}

/** Хост адреси; повна чужа адреса назовні не йде — у ній може бути секретний ключ */
function hostOf(uri: unknown): string | null {
  if (typeof uri !== 'string' || uri === '') return null;
  try {
    return new URL(uri).host;
  } catch {
    return 'unparsable';
  }
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Куди йдуть вебхуки номера і явна підписка (CHAT-3b1, design.md D4–D6). Meta вирішує призначення так:
 * номер → WABA → застосунок. Ми ставимо лише рівень НОМЕРА, тож решта номерів спільного WABA не
 * зачіпається. Нічого не підписується саме: ні підключення, ні синхронізація, ні вмикання номера. Виклики до
 * Meta не сидять у транзакції; кожен пишеться в журнал викликів.
 */
@Injectable()
export class WebhookSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly crypto: CryptoService,
    private readonly logs: ChannelLogService,
    private readonly accounts: MessagingAccountService,
  ) {}

  async status(channelId: string): Promise<WebhookStatus> {
    const channel = await this.load(channelId);
    return this.read(channel, 'webhook');
  }

  async subscribe(channelId: string, dto: SubscribeWebhook): Promise<WebhookStatus> {
    const channel = await this.load(channelId);
    if (!channel.address) {
      throw new ConflictException(
        'No public address is configured for this deployment (CHANNEL_WEBHOOK_BASE_URL)',
      );
    }

    const before = await this.read(channel, 'webhook');
    // Забирати чужі події можна лише свідомо: адмін називає хост, куди вони йдуть зараз
    if (before.state === 'elsewhere' && dto.replaceHost !== before.host) {
      throw new ConflictException(
        'Events for this number currently go to another host; name it to take them over',
      );
    }

    await this.call(channel, 'webhook', {
      method: 'POST',
      path: channel.externalId,
      body: {
        webhook_configuration: {
          override_callback_uri: channel.address,
          verify_token: channel.verifyToken,
        },
      },
    });

    const after = await this.read(channel, 'webhook');
    if (after.state !== 'ours') {
      // Meta відповіла успіхом, але призначення не наше: не вдаємо підписку
      throw new UnprocessableEntityException(
        'The provider accepted the call but the address was not applied',
      );
    }
    await this.setSubscribedAt(channelId, new Date());
    return { ...after, subscribedAt: new Date().toISOString() };
  }

  async unsubscribe(channelId: string): Promise<WebhookStatus> {
    const channel = await this.load(channelId);
    // Порожній override знімає рівень номера; чи так це робить Meta — перевіряється живою пробою (R, design D4)
    await this.call(channel, 'webhook', {
      method: 'POST',
      path: channel.externalId,
      body: {
        webhook_configuration: { override_callback_uri: '' },
      },
    });
    await this.setSubscribedAt(channelId, null);
    return this.read({ ...channel, webhookSubscribedAt: null }, 'webhook');
  }

  // -------------------------------------------------------------------------

  private async read(channel: LoadedChannel, operation: 'webhook'): Promise<WebhookStatus> {
    const { body } = await this.call(channel, operation, {
      method: 'GET',
      path: channel.externalId,
      query: { fields: 'webhook_configuration' },
    });
    const cfg = (body.webhook_configuration ?? {}) as WebhookConfiguration;
    const phone = str(cfg.phone_number);
    const waba = str(cfg.whatsapp_business_account);
    const app = str(cfg.application);

    // Діє перший наявний; порівнюємо з нашою адресою ПОВНІСТЮ, а назовні віддаємо лише хост
    const effective = phone ?? waba ?? app;
    const level = phone ? 'phone_number' : waba ? 'whatsapp_business_account' : app ? 'application' : null;
    const state: WebhookStatus['state'] =
      effective === null ? 'none' : channel.address && effective === channel.address ? 'ours' : 'elsewhere';

    return {
      state,
      level,
      host: hostOf(effective),
      configured: {
        phoneNumber: hostOf(phone),
        whatsappBusinessAccount: hostOf(waba),
        application: hostOf(app),
      },
      address: channel.address,
      subscribedAt: channel.webhookSubscribedAt?.toISOString() ?? null,
    };
  }

  private async call(
    channel: LoadedChannel,
    operation: 'webhook',
    request: {
      method: 'GET' | 'POST';
      path: string;
      query?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const started = Date.now();
    const client = new MetaGraphClient();
    try {
      const response = await client.request({
        ...request,
        token: channel.token,
        alsoRedact: [channel.verifyToken],
        operation,
      });
      await this.log(channel, true, started, request, response.status, null);
      return response;
    } catch (error) {
      await this.log(channel, false, started, request, null, error);
      throw this.toHttpError(error);
    }
  }

  private toHttpError(error: unknown): Error {
    if (!(error instanceof MetaApiError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    if (error.kind !== 'api') {
      return new ServiceUnavailableException('The provider is not reachable right now');
    }
    // Тут же приходить відмова рукостискання: Meta сама ходить на нашу адресу під час POST. 4xx, а не 5xx:
    // 5xx маскується фільтром, а причина адміну потрібна (це діагностика, не текст для клієнтів)
    return new UnprocessableEntityException(`The provider refused: ${error.title}`);
  }

  private async log(
    channel: LoadedChannel,
    ok: boolean,
    started: number,
    request: { method: string; path: string },
    status: number | null,
    error: unknown,
  ): Promise<void> {
    const meta = error instanceof MetaApiError ? error : null;
    await this.transactions.withTenantTx((tx) =>
      this.logs.record(tx, {
        accountId: channel.accountId,
        operation: 'webhook',
        ok,
        httpStatus: meta?.httpStatus ?? status,
        errorCode: meta?.code != null ? String(meta.code) : null,
        errorTitle: meta?.title ?? null,
        durationMs: Date.now() - started,
        detail: { endpoint: `${request.method} ${request.path}` },
        secrets: [channel.token, channel.verifyToken],
      }),
    );
  }

  private async setSubscribedAt(channelId: string, at: Date | null): Promise<void> {
    await this.transactions.withTenantTx((tx) =>
      tx.channel.update({ where: { id: channelId }, data: { webhookSubscribedAt: at } }),
    );
  }

  private async load(channelId: string): Promise<LoadedChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        accountId: true,
        externalId: true,
        provider: true,
        providerMissingAt: true,
        webhookSubscribedAt: true,
        account: {
          select: { credentials: true, verifyToken: true, webhookKey: true, provider: true, status: true },
        },
      },
    });
    // RLS показує лише канали цього тенанта: чужий id відповідає як неіснуючий
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.provider !== 'meta_cloud') {
      throw new ConflictException('Webhook subscription applies to WhatsApp (Meta) channels only');
    }
    if (channel.providerMissingAt !== null) {
      throw new ConflictException('The number no longer exists at the provider');
    }
    if (!channel.account.credentials) {
      throw new ConflictException('The account has no access token; connect it first');
    }
    return {
      id: channel.id,
      accountId: channel.accountId,
      externalId: channel.externalId,
      webhookSubscribedAt: channel.webhookSubscribedAt,
      token: this.crypto.decrypt(channel.account.credentials),
      verifyToken: channel.account.verifyToken,
      address: this.accounts.webhookAddress(channel.account.provider, channel.account.webhookKey),
    };
  }
}
