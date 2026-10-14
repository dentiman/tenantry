/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import {
  ChannelAdapterRegistry,
  ActivityRecorder,
  ChannelIngestService,
  ChannelStatusService,
  ConversationWorkflow,
  FakeChannelAdapter,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-2a, dev-інструменти: fake-канал і симулятор (spec chat/channels «A development provider can be
// set up without credentials», chat/customer-inbox «Messages can be received in development»).

describe('Chat dev tools (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let adminHeaders: { Authorization: string };
  let userHeaders: { Authorization: string };
  const userIds: string[] = [];
  const previousFlag = process.env.CHAT_DEV_TOOLS;

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    process.env.CHAT_DEV_TOOLS = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Симулятор ходить на власний публічний вебхук по HTTP — потрібен слухаючий сервер
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    process.env.CHAT_SIMULATOR_BASE_URL = `http://127.0.0.1:${String(port)}`;
    prisma = app.get(SystemPrismaService);

    const admin = await createAndLoginTestUser(app, prisma, {
      email: `dev-admin-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'Dev admin',
      role: 'ADMIN',
    });
    const user = await createAndLoginTestUser(app, prisma, {
      email: `dev-user-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'Dev user',
      role: 'USER',
    });
    userIds.push(admin.user.id, user.user.id);
    adminHeaders = { Authorization: `Bearer ${admin.tokens.accessToken}` };
    userHeaders = { Authorization: `Bearer ${user.tokens.accessToken}` };
  });

  beforeEach(() => {
    sentJobs.reset();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    delete process.env.CHAT_SIMULATOR_BASE_URL;
    if (previousFlag === undefined) delete process.env.CHAT_DEV_TOOLS;
    else process.env.CHAT_DEV_TOOLS = previousFlag;
    await app.close();
  });

  async function cleanup(): Promise<void> {
    const accounts = await prisma.messagingAccount.findMany({ where: { provider: 'fake' }, select: { id: true } });
    const ids = accounts.map((a) => a.id);
    const channels = await prisma.channel.findMany({ where: { accountId: { in: ids } }, select: { id: true } });
    await prisma.conversation.deleteMany({ where: { channelId: { in: channels.map((c) => c.id) } } });
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.messagingAccount.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(cleanup);

  it('створення fake-каналу: акаунт, канал і секрет підпису; повтор дає те саме', async () => {
    const first = await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);
    const body = first.body as { signingSecret: string; account: { provider: string; channels: { isEnabled: boolean }[] } };
    expect(body.signingSecret.length).toBeGreaterThan(20);
    expect(body.account).toMatchObject({ provider: 'fake' });
    expect(body.account.channels).toHaveLength(1);
    expect(body.account.channels[0]?.isEnabled).toBe(true);

    const second = await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);
    expect((second.body as { signingSecret: string }).signingSecret).toBe(body.signingSecret);
    expect(await prisma.messagingAccount.count({ where: { provider: 'fake' } })).toBe(1);
  });

  it('другий тенант теж отримує fake-канал: номер провайдера унікальний між тенантами, тож дістає суфікс', async () => {
    await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);

    const slug = `dev-second-${String(Date.now())}`;
    const email = `dev-second-${String(Date.now())}@example.com`;
    const tenant = await prisma.tenant.create({ data: { slug, name: 'Second' } });
    try {
      await prisma.user.create({
        data: { tenantId: tenant.id, email, name: 'Second admin', passwordHash: await argon2.hash('SecurePass123'), role: 'ADMIN' },
      });
      const login = await http().post('/api/auth/login').send({ email, password: 'SecurePass123', tenant: slug }).expect(200);
      const headers = { Authorization: `Bearer ${(login.body as { tokens: { accessToken: string } }).tokens.accessToken}` };

      await http().post('/api/dev/chat/fake-channel').set(headers).expect(200);

      const channels = await prisma.channel.findMany({ where: { provider: 'fake' }, select: { externalId: true, tenantId: true } });
      expect(channels).toHaveLength(2);
      expect(new Set(channels.map((c) => c.externalId)).size).toBe(2);
      expect(new Set(channels.map((c) => c.tenantId)).size).toBe(2);
    } finally {
      await cleanup();
      // Каскад прибирає юзера й сесії другого тенанта
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it('акаунт без секрету підпису (демо-сід) отримує секрет, а наявний канал лишається', async () => {
    const account = await prisma.messagingAccount.create({
      data: { tenantId: DEFAULT_TENANT_ID, provider: 'fake', name: 'Seeded', verifyToken: randomUUID(), webhookKey: randomUUID().replace(/-/g, '') },
    });
    await prisma.channel.create({
      data: { tenantId: DEFAULT_TENANT_ID, accountId: account.id, type: 'WHATSAPP', provider: 'fake', externalId: `fake-seeded-${randomUUID()}`, isEnabled: true },
    });

    const response = await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);
    const body = response.body as { signingSecret: string; account: { id: string; channels: unknown[] } };
    expect(body.account.id).toBe(account.id);
    expect(body.account.channels).toHaveLength(1);
    expect(body.signingSecret.length).toBeGreaterThan(20);
    expect((await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } })).appSecret).not.toBeNull();
  });

  it('симуляція: підписаний вебхук прийнято, подія збережена й поставлена в чергу; потім ingest створює розмову', async () => {
    await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);

    const res = await http()
      .post('/api/dev/chat/simulate')
      .set(adminHeaders)
      .send({ from: '+380 50 111 22 33', text: 'Доброго дня', profileName: 'Симуляція' })
      .expect(200);
    const { webhookStatus, externalMessageId } = res.body as { webhookStatus: number; externalMessageId: string };
    expect(webhookStatus).toBe(200);

    const account = await prisma.messagingAccount.findFirstOrThrow({ where: { provider: 'fake' } });
    const events = await prisma.channelWebhookEvent.findMany({ where: { accountId: account.id } });
    expect(events).toHaveLength(1);
    expect(sentJobs.forQueue('channels.ingest-webhook/channels-ingest')).toHaveLength(1);

    // Роль воркера: той самий ingest, у транзакції під контекстом тенанта
    const ingest = new ChannelIngestService(
      new ChannelAdapterRegistry().register(new FakeChannelAdapter()),
      new ChannelStatusService(),
      new ConversationWorkflow(new ActivityRecorder()),
    );
    const outcome = await app
      .get(TenantContextService)
      .runWith(DEFAULT_TENANT_ID, () =>
        app.get(TenantTransactions).withTenantTx((tx) => ingest.ingestEvent(tx, events[0]?.id ?? '')),
      );
    expect(outcome).toMatchObject({ state: 'PROCESSED', stored: 1 });

    const message = await prisma.chatMessage.findFirstOrThrow({ where: { externalId: externalMessageId } });
    expect(message).toMatchObject({ body: 'Доброго дня', direction: 'INBOUND', senderType: 'customer' });
    const contact = await prisma.channelContact.findFirstOrThrow({ where: { channelId: message.channelId ?? '' } });
    expect(contact.displayName).toBe('Симуляція');
  });

  it('те саме симульоване повідомлення двічі — одне повідомлення', async () => {
    await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);
    const send = () =>
      http()
        .post('/api/dev/chat/simulate')
        .set(adminHeaders)
        .send({ from: '380501112233', text: 'повтор', externalMessageId: 'sim-fixed-id' })
        .expect(200);
    await send();
    await send();

    const account = await prisma.messagingAccount.findFirstOrThrow({ where: { provider: 'fake' } });
    const events = await prisma.channelWebhookEvent.findMany({ where: { accountId: account.id }, orderBy: { receivedAt: 'asc' } });
    const ingest = new ChannelIngestService(
      new ChannelAdapterRegistry().register(new FakeChannelAdapter()),
      new ChannelStatusService(),
      new ConversationWorkflow(new ActivityRecorder()),
    );
    for (const event of events) {
      await app.get(TenantContextService).runWith(DEFAULT_TENANT_ID, () =>
        app.get(TenantTransactions).withTenantTx((tx) => ingest.ingestEvent(tx, event.id)),
      );
    }
    expect(await prisma.chatMessage.count({ where: { externalId: 'sim-fixed-id' } })).toBe(1);
  });

  it('simulate-status: підписана квитанція доходить до вебхука й після ingest змінює вихідне повідомлення (CHAT-2b)', async () => {
    await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(200);
    const account = await prisma.messagingAccount.findFirstOrThrow({ where: { provider: 'fake' } });
    const ingest = new ChannelIngestService(
      new ChannelAdapterRegistry().register(new FakeChannelAdapter()),
      new ChannelStatusService(),
      new ConversationWorkflow(new ActivityRecorder()),
    );
    const run = async (): Promise<void> => {
      const events = await prisma.channelWebhookEvent.findMany({ where: { accountId: account.id, state: 'RECEIVED' } });
      for (const event of events) {
        await app.get(TenantContextService).runWith(DEFAULT_TENANT_ID, () =>
          app.get(TenantTransactions).withTenantTx((tx) => ingest.ingestEvent(tx, event.id)),
        );
      }
    };

    await http().post('/api/dev/chat/simulate').set(adminHeaders).send({ from: '380501234500', text: 'привіт' }).expect(200);
    await run();
    const inbound = await prisma.chatMessage.findFirstOrThrow({ where: { direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const outbound = await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: inbound.conversationId,
        seq: inbound.seq + 1,
        kind: 'TEXT',
        status: 'SENT',
        senderType: 'user',
        body: 'відповідь',
        direction: 'OUTBOUND',
        channelId: inbound.channelId,
        externalId: 'fake-out-dev-1',
      },
    });

    const res = await http()
      .post('/api/dev/chat/simulate-status')
      .set(adminHeaders)
      .send({ messageId: outbound.id, status: 'delivered' })
      .expect(200);
    expect(res.body).toMatchObject({ webhookStatus: 200, externalMessageId: 'fake-out-dev-1' });
    await run();

    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: outbound.id } })).status).toBe('DELIVERED');
    // невідоме повідомлення — 409 з підказкою, а не тиха пустота
    await http().post('/api/dev/chat/simulate-status').set(adminHeaders).send({ messageId: randomUUID(), status: 'read' }).expect(409);
  });

  it('симуляція без fake-каналу — 409 з підказкою', async () => {
    await http().post('/api/dev/chat/simulate').set(adminHeaders).send({ from: '380501112233', text: 'x' }).expect(409);
  });

  it('не-адмін не користується ні створенням каналу, ні симулятором', async () => {
    await http().post('/api/dev/chat/fake-channel').set(userHeaders).expect(403);
    await http().post('/api/dev/chat/simulate').set(userHeaders).send({ from: '380501112233', text: 'x' }).expect(403);
    await http().post('/api/dev/chat/simulate-status').set(userHeaders).send({ externalMessageId: 'x', status: 'sent' }).expect(403);
  });

  it('без CHAT_DEV_TOOLS обидві дії відповідають як неіснуючий маршрут (404), навіть для адміна', async () => {
    process.env.CHAT_DEV_TOOLS = 'false';
    try {
      await http().post('/api/dev/chat/fake-channel').set(adminHeaders).expect(404);
      await http().post('/api/dev/chat/simulate').set(adminHeaders).send({ from: '380501112233', text: 'x' }).expect(404);
      await http().post('/api/dev/chat/simulate-status').set(adminHeaders).send({ externalMessageId: 'x', status: 'sent' }).expect(404);
    } finally {
      process.env.CHAT_DEV_TOOLS = 'true';
    }
    expect(await prisma.messagingAccount.count({ where: { provider: 'fake' } })).toBe(0);
  });
});
