import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PRISMA_BASE,
  TenantContextService,
  TenantTransactions,
  type PrismaService,
} from '@saas-skeleton/database';
import {
  ChannelAdapterRegistry,
  CryptoService,
  MessagePublisher,
  channelsIngestWebhookCommand,
  type ChannelAdapter,
  type ChannelCredentials,
  type RawWebhookRequest,
} from '@saas-skeleton/shared';

/** Результат POST-у вебхука для контролера: що відповісти провайдеру */
export type WebhookOutcome = { status: 'accepted' } | { status: 'bad-signature' };

interface ResolvedAccount {
  tenantId: string;
  accountId: string;
  adapter: ChannelAdapter;
}

/**
 * Публічний вебхук каналу (docs/whatsapp-channel.md §4.3; design.md D3). Усе, що відбувається
 * ДО автентифікації провайдера: знайти акаунт за ключем з адреси, перевірити підпис над
 * сирими байтами, зберегти тіло й поставити розбір у чергу — і лише потім відповісти.
 */
@Injectable()
export class ChannelWebhookService {
  private readonly logger = new Logger(ChannelWebhookService.name);

  constructor(
    @Inject(PRISMA_BASE) private readonly base: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly transactions: TenantTransactions,
    private readonly crypto: CryptoService,
    private readonly registry: ChannelAdapterRegistry,
    private readonly messages: MessagePublisher,
  ) {}

  /**
   * GET-рукостискання. `null` — відмова (контролер віддає 403): невідомий ключ, вимкнений
   * акаунт, невідомий провайдер чи не той verify token — одна відповідь на все.
   */
  async handshake(
    provider: string,
    key: string,
    query: Readonly<Record<string, string | undefined>>,
  ): Promise<string | null> {
    const account = await this.resolve(provider, key);
    if (!account) return null;

    const creds = await this.credentials(account);
    return account.adapter.handshake(query, creds);
  }

  async receive(
    provider: string,
    key: string,
    raw: RawWebhookRequest,
    ip: string | undefined,
  ): Promise<WebhookOutcome> {
    const account = await this.resolve(provider, key);
    if (!account) {
      // Невідомий ключ / вимкнений акаунт / невідомий провайдер: 200 і запис без тенанта.
      // Підпис тут перевірити нема чим, а відповідь не має бути оракулом (§4.3 п.2)
      await this.recordUnroutable(provider, key, 'unknown_key', ip);
      return { status: 'accepted' };
    }

    const creds = await this.credentials(account);
    if (!account.adapter.verifyWebhook(raw, creds)) {
      return { status: 'bad-signature' };
    }

    // Розбір тут — лише щоб одразу відрізнити «отруйне» тіло: воно зберігається як FAILED і
    // отримує 200, а не повторюється провайдером днями. Сам ingest розбирає тіло знову
    const parsed = account.adapter.parseWebhook(raw.body);
    const poisoned = parsed.error !== undefined;
    const eventId = randomUUID();
    const payloadHash = createHash('sha256').update(raw.body).digest('hex');

    await this.transactions.withTenantTx(async (tx) => {
      // skipDuplicates: дослівний повтор того самого тіла не створює другого рядка
      // (UNIQUE (account_id, payload_hash)) і не ставить другу роботу
      const inserted = await tx.channelWebhookEvent.createMany({
        data: [
          {
            id: eventId,
            accountId: account.accountId,
            body: raw.body.toString('utf8'),
            payloadHash,
            state: poisoned ? 'FAILED' : 'RECEIVED',
            error: parsed.error ?? null,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 1 && !poisoned) {
        await this.messages.publish(tx, channelsIngestWebhookCommand, { eventId });
      }
    });

    if (poisoned) {
      this.logger.warn(`Unparsable signed webhook stored as FAILED (account ${account.accountId})`);
    }
    return { status: 'accepted' };
  }

  /** Пошук за ключем ДО автентифікації: SECURITY DEFINER-функція, лише ідентифікатори */
  private async resolve(provider: string, key: string): Promise<ResolvedAccount | null> {
    const adapter = this.registry.get(provider);
    if (!adapter) return null;

    const rows = await this.base.$queryRaw<{ tenant_id: string; account_id: string }[]>`
      SELECT tenant_id, account_id FROM resolve_account_by_key(${provider}, ${key})`;
    const row = rows[0];
    if (!row) return null;

    // Дефолтний tenant контекст із middleware перекриваємо справжнім — далі все під RLS цього
    // тенанта
    this.tenantContext.set(row.tenant_id);
    return { tenantId: row.tenant_id, accountId: row.account_id, adapter };
  }

  private async credentials(account: ResolvedAccount): Promise<ChannelCredentials> {
    const row = await this.transactions.withTenantTx((tx) =>
      tx.messagingAccount.findUniqueOrThrow({
        where: { id: account.accountId },
        select: { appSecret: true, credentials: true, verifyToken: true },
      }),
    );
    return {
      appSecret: row.appSecret ? this.crypto.decrypt(row.appSecret) : null,
      accessToken: row.credentials ? this.crypto.decrypt(row.credentials) : null,
      verifyToken: row.verifyToken,
    };
  }

  /** Хеш ключа, не сам ключ: перелік ключів у журналі був би перелічуванням акаунтів */
  private async recordUnroutable(
    provider: string,
    key: string,
    reason: string,
    ip: string | undefined,
  ): Promise<void> {
    const keyHash = createHash('sha256').update(key).digest('hex');
    try {
      await this.base.$executeRaw`
        SELECT record_unroutable_event(${provider}, ${keyHash}, ${reason}, ${ip ?? null})`;
    } catch (error) {
      // Журнал — діагностика; його збій не має ламати відповідь провайдеру
      this.logger.warn(
        `Failed to record unroutable event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
