import { Injectable, Logger } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import { CryptoService } from '../crypto/crypto.service';
import type { ChannelAdapter, ChannelCredentials } from './channel-adapter';
import { ChannelAdapterRegistry } from './channel-adapter-registry';
import { ChannelLogService } from './channel-log.service';
import { MetaApiError } from './meta-cloud/graph-client';

/** Жорсткий таймаут одного виклику «прочитано» */
export const READ_RECEIPT_TIMEOUT_MS = 10_000;

interface ReadPlan {
  adapter: ChannelAdapter;
  creds: ChannelCredentials;
  accountId: string;
  channelExternalId: string;
  externalMessageId: string;
  secrets: string[];
}

/**
 * Сповіщення провайдера, що вхідне прочитане агентом (CHAT-3b3, spec chat/whatsapp-read-receipts).
 * «Забирання» повідомлень (дедуп) зробила транзакція, що зсунула курсор; тут лише сам виклик, і він
 * найкраще-що-вдасться: нічого не кидає, не повторює й не чіпає ні повідомлення, ні розмову. Відмова
 * провайдера — запис `read` у журналі викликів (успіхи не пишемо: це був би рядок на кожен перегляд).
 */
@Injectable()
export class ChannelReadReceiptService {
  private readonly logger = new Logger(ChannelReadReceiptService.name);

  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly transactions: TenantTransactions,
    private readonly crypto: CryptoService,
    private readonly logs: ChannelLogService,
  ) {}

  /** `sent` — виклик зроблено, `skipped` — нічого робити (нема що/кому/як), `failed` — відмову записано */
  async send(messageId: string): Promise<'sent' | 'skipped' | 'failed'> {
    const plan = await this.transactions.withTenantTx((tx) => this.plan(tx, messageId));
    if (!plan?.adapter.markRead) return 'skipped';

    const started = Date.now();
    try {
      await plan.adapter.markRead(
        {
          channelExternalId: plan.channelExternalId,
          externalMessageId: plan.externalMessageId,
          signal: AbortSignal.timeout(READ_RECEIPT_TIMEOUT_MS),
        },
        plan.creds,
      );
      return 'sent';
    } catch (error) {
      const durationMs = Date.now() - started;
      const meta = error instanceof MetaApiError ? error : null;
      this.logger.warn(`Read receipt for ${messageId} was not accepted: ${meta?.title ?? String(error)}`);
      await this.transactions.withTenantTx((tx) =>
        this.logs.record(tx, {
          accountId: plan.accountId,
          operation: 'read',
          ok: false,
          httpStatus: meta?.httpStatus ?? null,
          errorCode: meta?.code == null ? 'read_failed' : String(meta.code),
          errorTitle: meta?.title ?? (error instanceof Error ? error.message : 'Read receipt failed'),
          durationMs,
          messageId,
          detail: { endpoint: `${plan.channelExternalId}/messages`, providerMessageId: plan.externalMessageId },
          secrets: plan.secrets,
        }),
      );
      return 'failed';
    }
  }

  private async plan(
    tx: Parameters<Parameters<TenantTransactions['withTenantTx']>[0]>[0],
    messageId: string,
  ): Promise<ReadPlan | null> {
    const message = await tx.chatMessage.findFirst({
      where: { id: messageId, direction: 'INBOUND', externalId: { not: null } },
      select: { externalId: true, channelId: true },
    });
    if (!message?.externalId || !message.channelId) return null;

    const channel = await tx.channel.findUnique({
      where: { id: message.channelId },
      select: { externalId: true, accountId: true, provider: true, isEnabled: true },
    });
    if (!channel?.isEnabled) return null;

    const adapter = this.registry.get(channel.provider);
    if (!adapter?.markRead) return null;

    const account = await tx.messagingAccount.findUnique({
      where: { id: channel.accountId },
      select: { status: true, appSecret: true, credentials: true, verifyToken: true },
    });
    if (account?.status !== 'CONNECTED') return null;

    const creds: ChannelCredentials = {
      appSecret: account.appSecret ? this.crypto.decrypt(account.appSecret) : null,
      accessToken: account.credentials ? this.crypto.decrypt(account.credentials) : null,
      verifyToken: account.verifyToken,
    };
    return {
      adapter,
      creds,
      accountId: channel.accountId,
      channelExternalId: channel.externalId,
      externalMessageId: message.externalId,
      secrets: [creds.accessToken, creds.appSecret].filter((v): v is string => v !== null),
    };
  }
}
