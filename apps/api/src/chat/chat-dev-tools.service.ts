import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type {
  FakeChannelSetupResponse,
  NormalizedEvent,
  SimulateInbound,
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

  /** Ідемпотентно: повторний виклик повертає наявний акаунт і той самий секрет */
  async ensureFakeChannel(): Promise<FakeChannelSetupResponse> {
    const account =
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
    const hasChannel = await this.prisma.channel.count({ where: { accountId: account.id } });
    if (hasChannel === 0) {
      await this.prisma.channel.create({
        data: {
          accountId: account.id,
          type: 'WHATSAPP',
          provider: 'fake',
          externalId: FAKE_CHANNEL_EXTERNAL_ID,
          displayPhoneNumber: '+1 555 010 0001',
          verifiedName: 'Fake WhatsApp',
          isEnabled: true,
          isDefault: true,
          syncedAt: new Date(),
        },
      });
    }

    const [view] = (await this.accounts.list(true)).filter((a) => a.id === account.id);
    if (!view || !account.appSecret) throw new ConflictException('Fake account could not be read back');
    return { account: view, signingSecret: this.crypto.decrypt(account.appSecret) };
  }

  async simulate(input: SimulateInbound, baseUrl: string): Promise<SimulateInboundResponse> {
    const account = await this.prisma.messagingAccount.findFirst({ where: { provider: 'fake' } });
    const channel = account
      ? await this.prisma.channel.findFirst({ where: { accountId: account.id, isEnabled: true } })
      : null;
    if (!account?.appSecret || !channel) {
      throw new ConflictException('Create the fake channel first (POST /dev/chat/fake-channel)');
    }

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
    const body = Buffer.from(buildFakeWebhookBody([event]));
    const secret = this.crypto.decrypt(account.appSecret);

    const response = await fetch(`${baseUrl}/api/public/channels/fake/${account.webhookKey}`, {
      method: 'POST',
      // Не JSON: підпис рахується над точними байтами, а тип тіла вебхукові байдужий
      headers: { 'Content-Type': 'application/octet-stream', [FAKE_SIGNATURE_HEADER]: signFakeBody(secret, body) },
      body,
    });
    return { externalMessageId, webhookStatus: response.status };
  }
}
