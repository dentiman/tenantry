/// <reference types="jest" />

import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  ChannelAdapterRegistry,
  ChannelIngestService,
  ChannelStatusService,
  ConversationWorkflow,
  CryptoService,
  MetaCloudAdapter,
  type IngestOutcome,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  accountUpdateHook,
  failedHook,
  mediaHook,
  statusHook,
  templateStatusHook,
  textHook,
} from '../../../libs/shared/src/channels/meta-cloud/testing/webhook-fixtures';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3b2: справжні за формою Meta-вебхуки проходять публічну адресу, а потім ingest → розмови, повідомлення, квитанції.

const APP_SECRET = 'e2e-meta-app-secret-0123456789';
const PHONE = '109000000000888';
const nowSeconds = (): string => String(Math.floor(Date.now() / 1000));

describe('Meta inbound and receipts (e2e, CHAT-3b2)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let ingest: ChannelIngestService;
  let accountId: string;
  let channelId: string;
  let key: string;
  let agentHeaders: { Authorization: string };
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const sign = (body: string): string => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

  /** Те саме, що робить Meta: підписаний POST на публічну адресу, а потім розбір збереженого рядка (воркер) */
  async function deliver(body: string): Promise<IngestOutcome> {
    await http()
      .post(`/api/public/channels/meta_cloud/${key}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body)
      .expect(200);
    const stored = await prisma.channelWebhookEvent.findFirstOrThrow({
      where: { accountId, body },
      orderBy: { receivedAt: 'desc' },
    });
    return tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      transactions.withTenantTx((tx) => ingest.ingestEvent(tx, stored.id)),
    );
  }

  const messages = () => prisma.chatMessage.findMany({ where: { channelId }, orderBy: [{ conversationId: 'asc' }, { seq: 'asc' }] });

  async function outbound(opts: { externalId?: string; status?: 'QUEUED' | 'SENDING' | 'SENT' } = {}): Promise<{ id: string; conversationId: string }> {
    const contact = await prisma.channelContact.create({ data: { tenantId: DEFAULT_TENANT_ID, channelId } });
    await prisma.channelContactAddress.create({ data: { tenantId: DEFAULT_TENANT_ID, contactId: contact.id, channelId, kind: 'phone', value: '380000000009' } });
    const conversation = await prisma.conversation.create({
      data: { tenantId: DEFAULT_TENANT_ID, kind: 'CUSTOMER', access: 'tenant', channelId, contactId: contact.id, lastSeq: 1 },
    });
    const message = await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        seq: 1,
        kind: 'TEXT',
        status: opts.status ?? 'SENT',
        senderType: 'user',
        body: 'out',
        direction: 'OUTBOUND',
        channelId,
        externalId: opts.externalId ?? null,
      },
    });
    return { id: message.id, conversationId: conversation.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    transactions = app.get(TenantTransactions);
    ingest = new ChannelIngestService(
      new ChannelAdapterRegistry().register(new MetaCloudAdapter()),
      new ChannelStatusService(),
      new ConversationWorkflow(new ActivityRecorder()),
    );
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `meta-wh-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'meta-wh',
      role: 'USER',
    });
    userIds.push(user.id);
    agentHeaders = { Authorization: `Bearer ${tokens.accessToken}` };
  });

  beforeEach(async () => {
    key = randomBytes(16).toString('hex');
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'meta webhook e2e',
          verifyToken: 'v',
          webhookKey: key,
          appSecret: app.get(CryptoService).encrypt(APP_SECRET),
        },
      })
    ).id;
    channelId = (
      await prisma.channel.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, type: 'WHATSAPP', provider: 'meta_cloud', externalId: PHONE, displayPhoneNumber: '+1 555 000 0888', isEnabled: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.channelPendingStatus.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.deleteMany({ where: { id: accountId } });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  describe('вхідні', () => {
    it('перший текст створює контакт, відкриту розмову й повідомлення; вікно відкрите — відповідь приймається', async () => {
      const outcome = await deliver(textHook({ id: 'wamid.IN1', from: '380501112233', name: 'Олена', body: 'Доброго дня', timestamp: nowSeconds(), phoneId: PHONE, bsuid: 'UA.55' }));
      expect(outcome).toMatchObject({ state: 'PROCESSED', stored: 1 });

      const [message] = await messages();
      expect(message).toMatchObject({ direction: 'INBOUND', body: 'Доброго дня', externalId: 'wamid.IN1', status: 'SENT', senderLabel: 'Олена' });
      expect(message?.providerMeta).toMatchObject({ from_user_id: 'UA.55' });

      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: message?.conversationId ?? '' } });
      expect(conversation).toMatchObject({ status: 'OPEN', lastMessagePreview: 'Доброго дня' });
      expect(conversation.customerLastMessageAt).not.toBeNull();
      const address = await prisma.channelContactAddress.findFirstOrThrow({ where: { channelId, value: '380501112233' } });
      const contact = await prisma.channelContact.findUniqueOrThrow({ where: { id: address.contactId } });
      expect(contact.displayName).toBe('Олена');

      const reply = await http().post(`/api/conversations/${conversation.id}/messages`).set(agentHeaders).send({ body: 'Вітаю!', clientMessageId: '5c0f3a52-6d2b-4a53-8d3c-2f9b2f0e6a11' });
      expect(reply.status).toBe(201);
    });

    it('повторна доставка того самого повідомлення (інші байти) нічого не додає', async () => {
      await deliver(textHook({ id: 'wamid.DUP', timestamp: nowSeconds(), phoneId: PHONE }));
      const again = await deliver(textHook({ id: 'wamid.DUP', timestamp: nowSeconds(), phoneId: PHONE, body: 'ще раз' }));
      expect(again.stored).toBe(0);
      expect(await messages()).toHaveLength(1);
    });

    it('картинка і документ лишають заглушку з типом, превʼю розмови — заглушка', async () => {
      await deliver(mediaHook({ id: 'wamid.IMG', type: 'image', phoneId: PHONE }));
      const [image] = await messages();
      expect(image).toMatchObject({ body: '[image]', direction: 'INBOUND' });
      expect(image?.payload).toEqual({ unsupported: { type: 'image' } });
      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: image?.conversationId ?? '' } });
      expect(conversation.lastMessagePreview).toBe('[image]');

      await deliver(mediaHook({ id: 'wamid.DOC', type: 'document', phoneId: PHONE }));
      expect((await messages()).map((m) => m.body)).toEqual(['[image]', '[document]']);
    });

    it('шаблон і оновлення акаунта зберігаються й нічого не змінюють', async () => {
      const before = await prisma.conversation.count();
      expect(await deliver(templateStatusHook())).toMatchObject({ state: 'PROCESSED', stored: 0 });
      expect(await deliver(accountUpdateHook())).toMatchObject({ state: 'PROCESSED', stored: 0 });
      expect(await prisma.conversation.count()).toBe(before);
    });

    it('невідомий phone_number_id — нероутоване, розмов немає', async () => {
      const outcome = await deliver(textHook({ id: 'wamid.LOST', phoneId: '999999999999999' }));
      expect(outcome.state).toBe('UNROUTABLE');
      expect(await messages()).toHaveLength(0);
    });
  });

  describe('квитанції', () => {
    it('delivered, потім read — вперед; запізніле sent не повертає назад; час — від провайдера', async () => {
      const { id } = await outbound({ externalId: 'wamid.OUT1' });

      await deliver(statusHook({ id: 'wamid.OUT1', status: 'delivered', timestamp: '1791961500', phoneId: PHONE }));
      let row = await prisma.chatMessage.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('DELIVERED');
      expect(row.deliveredAt?.toISOString()).toBe(new Date(1791961500 * 1000).toISOString());

      await deliver(statusHook({ id: 'wamid.OUT1', status: 'read', timestamp: '1791961600', phoneId: PHONE }));
      await deliver(statusHook({ id: 'wamid.OUT1', status: 'sent', timestamp: '1791961400', phoneId: PHONE }));
      row = await prisma.chatMessage.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('READ');
    });

    it('квитанція, що випередила запис external_id, знаходить повідомлення за нашим id з biz_opaque_callback_data', async () => {
      const { id } = await outbound({ status: 'SENDING' });
      await deliver(statusHook({ id: 'wamid.EARLY', status: 'delivered', opaque: id, phoneId: PHONE }));
      expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id } })).status).toBe('DELIVERED');
    });

    it('невідоме повідомлення паркується', async () => {
      await deliver(statusHook({ id: 'wamid.NOBODY', status: 'delivered', phoneId: PHONE }));
      expect(await prisma.channelPendingStatus.count({ where: { accountId, externalId: 'wamid.NOBODY' } })).toBe(1);
    });

    it('failed 131049: FAILED, клас POLICY, код і пояснення Meta', async () => {
      const { id } = await outbound({ externalId: 'wamid.BAD' });
      await deliver(failedHook({ id: 'wamid.BAD', code: 131049, details: 'engagement policy', phoneId: PHONE }));
      const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('FAILED');
      expect(row.failure).toMatchObject({ class: 'POLICY', code: '131049', details: 'engagement policy' });
    });
  });

  describe('прапорець квитанцій', () => {
    it('залежить від підписки номера: без неї false, з нею true, після зняття знову false', async () => {
      const { conversationId } = await outbound({ externalId: 'wamid.FLAG' });
      const flag = async (): Promise<boolean> => {
        const res = await http().get(`/api/conversations/${conversationId}`).set(agentHeaders).expect(200);
        return (res.body as { contact: { deliveryReceipts: boolean } }).contact.deliveryReceipts;
      };
      expect(await flag()).toBe(false);
      await prisma.channel.update({ where: { id: channelId }, data: { webhookSubscribedAt: new Date() } });
      expect(await flag()).toBe(true);
      await prisma.channel.update({ where: { id: channelId }, data: { webhookSubscribedAt: null } });
      expect(await flag()).toBe(false);
    });
  });
});
