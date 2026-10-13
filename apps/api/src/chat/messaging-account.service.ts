import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { MessagingAccountResponse } from '@saas-skeleton/contracts';
import { CHANNEL_SELECT, toMessagingAccountResponse } from './channel.mapper';

const DAY_MS = 24 * 3_600_000;

/**
 * Акаунт(и) каналів тенанта для адміна (CHAT-2a, design.md D3a): що налаштовано, куди провайдер
 * має слати вебхук і чи щось уже приходило. Облікові дані — лише «задано / ні».
 */
@Injectable()
export class MessagingAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** База публічної адреси вебхука; без неї адреса «недоступна», а не вгадана */
  private webhookBase(): string | null {
    const raw = process.env.CHANNEL_WEBHOOK_BASE_URL?.trim();
    return raw ? raw.replace(/\/+$/, '') : null;
  }

  async list(includeSecrets: boolean): Promise<MessagingAccountResponse[]> {
    const accounts = await this.prisma.messagingAccount.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        credentials: true,
        appSecret: true,
        verifyToken: true,
        webhookKey: true,
        channels: {
          where: { providerMissingAt: null },
          orderBy: { createdAt: 'asc' },
          select: CHANNEL_SELECT,
        },
      },
    });

    const since = new Date(Date.now() - DAY_MS);
    const base = this.webhookBase();

    return Promise.all(
      accounts.map(async (account) => {
        const [grouped, last] = await Promise.all([
          this.prisma.channelWebhookEvent.groupBy({
            by: ['state'],
            where: { accountId: account.id, receivedAt: { gte: since } },
            _count: { _all: true },
          }),
          this.prisma.channelWebhookEvent.findFirst({
            where: { accountId: account.id },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
          }),
        ]);
        const count = (state: string): number =>
          grouped.find((g) => g.state === state)?._count._all ?? 0;

        return toMessagingAccountResponse(
          { ...account, channels: account.channels },
          {
            address: base
              ? `${base}/api/public/channels/${account.provider}/${account.webhookKey}`
              : null,
            lastDeliveryAt: last?.receivedAt ?? null,
            last24h: {
              received: count('RECEIVED'),
              processed: count('PROCESSED'),
              failed: count('FAILED'),
              unroutable: count('UNROUTABLE'),
            },
          },
          includeSecrets,
        );
      }),
    );
  }
}
