import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@saas-skeleton/database';
import type {
  FakeChannelSetupResponse,
  NormalizedEvent,
  SimulateInbound,
  SimulateStatus,
  SimulateInboundResponse,
} from '@saas-skeleton/contracts';
import {
  CryptoService,
  FAKE_SIGNATURE_HEADER,
  buildFakeWebhookBody,
  signFakeBody,
} from '@saas-skeleton/shared';
import { MessagingAccountService } from './messaging-account.service';

/** Номер fake-каналу в провайдера: стабільний, щоб симулятор і вебхук говорили про один канал */
export const FAKE_CHANNEL_EXTERNAL_ID = 'fake-phone-1';

/**
 * Інструменти розробки (CHAT-2a, design.md D9): створити fake-акаунт із каналом і «надіслати»
 * вхідне так, як це зробив би провайдер — підписаним запитом на ПУБЛІЧНИЙ вебхук. Через HTTP
 * до самого себе, а не викликом ingest напряму: інакше ні підпис, ні сире сховище, ні ліміт, ні
 * відповіді 200/401 не були б перевірені. Доступ — `ChatDevToolsGuard` + роль ADMIN.
 */
@Injectable()
export class ChatDevToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly accounts: MessagingAccountService,
  ) {}

  /**
   * Ідемпотентно: повторний виклик повертає наявний акаунт і той самий секрет. Акаунт, створений демо-сідом
   * (`seed-customer-chat.ts`), секрету не має — тут його довипускаємо, а наявний канал лишаємо як є.
   */
  async ensureFakeChannel(): Promise<FakeChannelSetupResponse> {
    let account =
      (await this.prisma.messagingAccount.findFirst({ where: { provider: 'fake' } })) ??
      (await this.prisma.messagingAccount.create({
        data: {
          provider: 'fake',
          name: 'Fake provider (development)',
          verifyToken: randomBytes(16).toString('hex'),
          webhookKey: randomBytes(16).toString('hex'),
          appSecret: this.crypto.encrypt(randomBytes(24).toString('hex')),
        },
      }));
    if (!account.appSecret) {
      account = await this.prisma.messagingAccount.update({
        where: { id: account.id },
        data: { appSecret: this.crypto.encrypt(randomBytes(24).toString('hex')) },
      });
    }
    const hasChannel = await this.prisma.channel.count({ where: { accountId: account.id } });
    if (hasChannel === 0) {
      await this.createChannel(account.id);
    }

    const [view] = (await this.accounts.list(true)).filter((a) => a.id === account.id);
    if (!view || !account.appSecret) throw new ConflictException('Fake account could not be read back');
    return { account: view, signingSecret: this.crypto.decrypt(account.appSecret) };
  }

  /**
   * Номер провайдера унікальний між тенантами (часткове UNIQUE), а це інструмент для будь-якого
   * тенанта: перший бере стабільний `fake-phone-1`, наступним (конфлікт) дістається суфікс з id акаунта.
   */
  private async createChannel(accountId: string): Promise<void> {
    const base = {
      accountId,
      type: 'WHATSAPP' as const,
      provider: 'fake',
      displayPhoneNumber: '+1 555 010 0001',
      verifiedName: 'Fake WhatsApp',
      isEnabled: true,
      isDefault: true,
      syncedAt: new Date(),
    };
    try {
      await this.prisma.channel.create({ data: { ...base, externalId: FAKE_CHANNEL_EXTERNAL_ID } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      await this.prisma.channel.create({
        data: { ...base, externalId: `${FAKE_CHANNEL_EXTERNAL_ID}-${accountId.slice(0, 8)}` },
      });
    }
  }

  async simulate(input: SimulateInbound, baseUrl: string): Promise<SimulateInboundResponse> {
    const { account, channel } = await this.fakeChannel();

    const externalMessageId = input.externalMessageId ?? `sim-${randomUUID()}`;
    const event: NormalizedEvent = {
      kind: 'message',
      externalMessageId,
      channelExternalId: channel.externalId,
      from: { kind: 'phone', value: input.from.replace(/\D/g, '') },
      profileName: input.profileName ?? null,
      sentAt: new Date().toISOString(),
      content: { type: 'text', body: input.text },
      providerMeta: { simulated: true },
    };
    const webhookStatus = await this.postSigned(account, [event], baseUrl);
    return { externalMessageId, webhookStatus };
  }

  /** Квитанція про вихідне — тим самим підписаним шляхом, що й вхідне (CHAT-2b) */
  async simulateStatus(input: SimulateStatus, baseUrl: string): Promise<SimulateInboundResponse> {
    const { account, channel } = await this.fakeChannel();

    let externalMessageId = input.externalMessageId;
    let opaqueId: string | null = null;
    if (input.messageId) {
      const message = await this.prisma.chatMessage.findFirst({
        where: { id: input.messageId, direction: 'OUTBOUND' },
        select: { id: true, externalId: true },
      });
      if (!message) throw new ConflictException('Outbound message not found');
      opaqueId = message.id;
      // Квитанція може випередити запис id: тоді шлемо id, який дав би fake (`fake-out-<id>`)
      externalMessageId ??= message.externalId ?? `fake-out-${message.id}`;
    }
    if (!externalMessageId) {
      throw new ConflictException('Give messageId or externalMessageId');
    }

    const event: NormalizedEvent = {
      kind: 'status',
      channelExternalId: channel.externalId,
      externalMessageId,
      opaqueId,
      status: input.status,
      occurredAt: new Date().toISOString(),
      failure:
        input.status === 'failed'
          ? { class: 'PERMANENT', code: input.failure?.code ?? '131026', title: input.failure?.title ?? 'Simulated failure' }
          : null,
      providerMeta: { simulated: true },
    };
    const webhookStatus = await this.postSigned(account, [event], baseUrl);
    return { externalMessageId, webhookStatus };
  }

  private async fakeChannel(): Promise<{
    account: { webhookKey: string; appSecret: string };
    channel: { externalId: string };
  }> {
    const account = await this.prisma.messagingAccount.findFirst({ where: { provider: 'fake' } });
    const channel = account
      ? await this.prisma.channel.findFirst({ where: { accountId: account.id, isEnabled: true } })
      : null;
    if (!account?.appSecret || !channel) {
      throw new ConflictException('Create the fake channel first (POST /dev/chat/fake-channel)');
    }
    return { account: { webhookKey: account.webhookKey, appSecret: account.appSecret }, channel };
  }

  private async postSigned(
    account: { webhookKey: string; appSecret: string },
    events: NormalizedEvent[],
    baseUrl: string,
  ): Promise<number> {
    const body = Buffer.from(buildFakeWebhookBody(events));
    const secret = this.crypto.decrypt(account.appSecret);
    const response = await fetch(`${baseUrl}/api/public/channels/fake/${account.webhookKey}`, {
      method: 'POST',
      // Не JSON: підпис рахується над точними байтами, а тип тіла вебхукові байдужий
      headers: { 'Content-Type': 'application/octet-stream', [FAKE_SIGNATURE_HEADER]: signFakeBody(secret, body) },
      body,
    });
    return response.status;
  }
}
