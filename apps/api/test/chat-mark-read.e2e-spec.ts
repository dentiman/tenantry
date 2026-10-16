/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PrismaService,
  SystemPrismaModule, SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import {
  ChannelAdapterRegistry,
  ChannelLogService,
  ChannelReadReceiptService,
  CryptoService,
  FakeChannelAdapter,
  MetaCloudAdapter,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  GraphStub,
  graphError,
} from '../../../libs/shared/src/channels/meta-cloud/testing/graph-stub';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3b3 (spec chat/whatsapp-read-receipts): агент прочитав вхідне → провайдеру іде одне «прочитано».

process.env.CHAT_DEV_TOOLS = 'true';

const QUEUE = 'channels.mark-read/channels-mark-read';
const TOKEN = 'EAAGreadTOKENvalueABCDEFGHIJKLMNOP1234567890xyz';
const PHONE_ID = '109000000000009';
const DAY = 24 * 3_600_000;

describe('Mark as read (e2e, CHAT-3b3)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let receipts: ChannelReadReceiptService;
  let agent: { id: string; headers: { Authorization: string } };
  let other: { id: string; headers: { Authorization: string } };
  let accountId: string;
  let channelId: string;
  const stub = new GraphStub();
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    process.env.META_GRAPH_BASE_URL = await stub.start();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    const crypto = app.get(CryptoService);
    receipts = new ChannelReadReceiptService(
      new ChannelAdapterRegistry().register(new MetaCloudAdapter()).register(new FakeChannelAdapter()),
      app.get(TenantTransactions),
      crypto,
      new ChannelLogService(app.get(PrismaService)),
    );
    for (const [name, slot] of [['reader-a', 'agent'], ['reader-b', 'other']] as const) {
      const { user, tokens } = await createAndLoginTestUser(app, prisma, {
        email: `mark-read-${name}-${String(Date.now())}@example.com`,
        password: 'SecurePass123',
        name,
        role: 'USER',
      });
      userIds.push(user.id);
      const ref = { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
      if (slot === 'agent') agent = ref;
      else other = ref;
    }
  });

  beforeEach(async () => {
    stub.reset();
    sentJobs.reset();
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'mark-read e2e',
          externalId: '1000000000009',
          credentials: app.get(CryptoService).encrypt(TOKEN),
          verifyToken: 'v',
          webhookKey: randomBytes(16).toString('hex'),
        },
      })
    ).id;
    channelId = (
      await prisma.channel.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId,
          type: 'WHATSAPP',
          provider: 'meta_cloud',
          externalId: PHONE_ID,
          displayPhoneNumber: '+1 555 000 0009',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.messagingAccount.deleteMany({ where: { id: accountId } });
  });

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await stub.stop();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  /** Клієнтська розмова з вхідними (`ageDays` — вік кожного; seq = 1..n) */
  async function conversation(ageDays: number[]): Promise<{ id: string; messages: string[] }> {
    const contact = await prisma.channelContact.create({
      data: { tenantId: DEFAULT_TENANT_ID, channelId, displayName: 'Клієнт' },
    });
    const conv = await prisma.conversation.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        kind: 'CUSTOMER',
        access: 'tenant',
        channelId,
        contactId: contact.id,
        lastSeq: ageDays.length,
        customerLastMessageAt: new Date(),
      },
    });
    const messages: string[] = [];
    for (const [n, age] of ageDays.entries()) {
      const when = new Date(Date.now() - age * DAY);
      const created = await prisma.chatMessage.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conv.id,
          seq: n + 1,
          kind: 'TEXT',
          senderType: 'customer',
          senderLabel: 'Клієнт',
          body: `msg ${String(n + 1)}`,
          direction: 'INBOUND',
          channelId,
          externalId: `wamid.READ${String(n)}${randomUUID()}`,
          senderContactId: contact.id,
          providerSentAt: when,
          createdAt: when,
        },
      });
      messages.push(created.id);
    }
    return { id: conv.id, messages };
  }

  const read = (user: { headers: { Authorization: string } }, id: string, seq: number) =>
    http().post(`/api/conversations/${id}/read`).set(user.headers).send({ seq });
  const claimedAt = (id: string) =>
    prisma.chatMessage.findUniqueOrThrow({ where: { id }, select: { providerReadAt: true } });
  const run = (messageId: string) =>
    tenantContext.runWith(DEFAULT_TENANT_ID, () => receipts.send(messageId));

  it('агент відкрив вхідні: усі до курсора «забрано», одна робота на найновіше', async () => {
    const { id, messages } = await conversation([0, 0, 0]);

    await read(agent, id, 3).expect(204);

    for (const messageId of messages) {
      expect((await claimedAt(messageId)).providerReadAt).not.toBeNull();
    }
    const jobs = sentJobs.forQueue(QUEUE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.envelope).toMatchObject({ data: { conversationId: id, messageId: messages[2] } });
  });

  it('другий агент і повторний рух курсора нічого нового не забирають', async () => {
    const { id } = await conversation([0, 0]);

    await read(agent, id, 2).expect(204);
    await read(other, id, 2).expect(204);
    await read(agent, id, 2).expect(204);

    expect(sentJobs.forQueue(QUEUE)).toHaveLength(1);
  });

  it('два одночасні запити — рівно одна робота', async () => {
    const { id } = await conversation([0]);

    await Promise.all([read(agent, id, 1), read(other, id, 1)]);

    expect(sentJobs.forQueue(QUEUE)).toHaveLength(1);
  });

  it('нове вхідне після прочитаного підтверджується окремо, старі не повторюються', async () => {
    const { id, messages } = await conversation([0]);
    await read(agent, id, 1).expect(204);

    const created = await prisma.chatMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: id,
        seq: 2,
        kind: 'TEXT',
        senderType: 'customer',
        body: 'ще',
        direction: 'INBOUND',
        channelId,
        externalId: `wamid.NEW${randomUUID()}`,
        providerSentAt: new Date(),
      },
    });
    await prisma.conversation.update({ where: { id }, data: { lastSeq: 2 } });
    await read(agent, id, 2).expect(204);

    const jobs = sentJobs.forQueue(QUEUE);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.envelope).toMatchObject({ data: { messageId: created.id } });
    expect(JSON.stringify(jobs[1]?.envelope)).not.toContain(messages[0] ?? 'x');
  });

  it('вхідне старше 30 днів не забирається, і роботи нема', async () => {
    const { id, messages } = await conversation([31]);

    await read(agent, id, 1).expect(204);

    expect((await claimedAt(messages[0] ?? '')).providerReadAt).toBeNull();
    expect(sentJobs.forQueue(QUEUE)).toHaveLength(0);
  });

  it('внутрішня розмова нічого не підтверджує', async () => {
    const created = await http()
      .post('/api/conversations')
      .set(agent.headers)
      .send({ participantUserIds: [other.id], title: 'internal read' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await http()
      .post(`/api/conversations/${id}/messages`)
      .set(other.headers)
      .send({ body: 'привіт', clientMessageId: randomUUID() })
      .expect(201);

    await read(agent, id, 2).expect(204);

    expect(sentJobs.forQueue(QUEUE)).toHaveLength(0);
    await prisma.conversation.delete({ where: { id } });
  });

  describe('виклик провайдера', () => {
    it('Meta: один запит status=read із id вхідного, токен лише в заголовку, у журналі тиша', async () => {
      const { messages } = await conversation([0]);
      const wamid = (await prisma.chatMessage.findUniqueOrThrow({ where: { id: messages[0] ?? '' } })).externalId;
      stub.route('POST', `${PHONE_ID}/messages`, { body: { success: true } });

      expect(await run(messages[0] ?? '')).toBe('sent');

      const call = stub.requests.find((r) => r.path === `${PHONE_ID}/messages`);
      expect(call?.body).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: wamid });
      expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call?.url).not.toContain(TOKEN);
      expect(await prisma.channelLog.count({ where: { accountId } })).toBe(0);
    });

    it('відмова Meta: запис `read` у журналі без токена, без винятку й без зміни повідомлення', async () => {
      const { messages } = await conversation([0]);
      stub.route('POST', `${PHONE_ID}/messages`, graphError(131009, `bad ${TOKEN}`, 400));

      expect(await run(messages[0] ?? '')).toBe('failed');

      const entries = await prisma.channelLog.findMany({ where: { accountId } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ operation: 'read', ok: false, errorCode: '131009' });
      expect(JSON.stringify(entries)).not.toContain(TOKEN);
      expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: messages[0] ?? '' } })).status).toBe('SENT');
    });

    it('акаунт потребує повторної авторизації — виклику нема', async () => {
      const { messages } = await conversation([0]);
      await prisma.messagingAccount.update({ where: { id: accountId }, data: { status: 'NEEDS_REAUTH' } });

      expect(await run(messages[0] ?? '')).toBe('skipped');
      expect(stub.requests).toHaveLength(0);
    });

    it('вимкнений канал — виклику нема', async () => {
      const { messages } = await conversation([0]);
      await prisma.channel.update({ where: { id: channelId }, data: { isEnabled: false } });

      expect(await run(messages[0] ?? '')).toBe('skipped');
      expect(stub.requests).toHaveLength(0);
    });
  });
});
