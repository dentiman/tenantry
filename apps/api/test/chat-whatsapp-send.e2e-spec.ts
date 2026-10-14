/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PrismaService,
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import {
  ChannelAdapterRegistry,
  ChannelDeliveryService,
  ChannelLogService,
  ChannelStatusService,
  CryptoService,
  MetaCloudAdapter,
  RetryableDeliveryError,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  GraphStub,
  graphError,
  sendOk,
} from '../../../libs/shared/src/channels/meta-cloud/testing/graph-stub';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3a: відповідь у розмову з WhatsApp-каналом — вікно за вирішенням провайдера, шаблон, доставка через
// справжній MetaCloudAdapter проти локального стаба. Мережі немає.

process.env.CHAT_DEV_TOOLS = 'true';

const DELIVER_QUEUE = 'channels.deliver-outbound/channels-deliver';
const TOKEN = 'EAAGsendTOKENvalueABCDEFGHIJKLMNOP1234567890xyz';
const PHONE_ID = '109000000000001';

interface MessageBody {
  id: string;
  status: string;
  body: string | null;
  payload: { template?: { name: string; language: string } };
  direction: string | null;
  senderId: string | null;
}

describe('WhatsApp send (e2e, CHAT-3a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let delivery: ChannelDeliveryService;
  let agent: { id: string; headers: { Authorization: string } };
  let accountId: string;
  let channelId: string;
  const stub = new GraphStub();
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    process.env.META_GRAPH_BASE_URL = await stub.start();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantContext = app.get(TenantContextService);
    transactions = app.get(TenantTransactions);
    delivery = new ChannelDeliveryService(
      new ChannelAdapterRegistry().register(new MetaCloudAdapter()),
      transactions,
      app.get(CryptoService),
      new ChannelStatusService(),
      new ChannelLogService(app.get(PrismaService)),
    );
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `wa-send-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'wa-send',
      role: 'USER',
    });
    userIds.push(user.id);
    agent = { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  });

  beforeEach(async () => {
    stub.reset();
    sentJobs.reset();
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'send e2e',
          externalId: '1000000000001',
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
          displayPhoneNumber: '+1 555 000 0001',
          isEnabled: true,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channelId } });
    await prisma.messagingAccount.deleteMany({ where: { id: accountId } });
    await prisma.messagingAccount.deleteMany({
      where: { provider: 'fake', name: 'send e2e fake' },
    });
  });

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await stub.stop();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  /** Розмова на Meta-каналі; `customerAt` — час останнього вхідного (null — клієнт ніколи не писав) */
  async function conversation(
    opts: { customerAt?: Date | null; phone?: string } = {},
  ): Promise<{ id: string; phone: string }> {
    const phone = opts.phone ?? `38050${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const contact = await prisma.channelContact.create({
      data: { tenantId: DEFAULT_TENANT_ID, channelId, displayName: 'Клієнт' },
    });
    await prisma.channelContactAddress.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        contactId: contact.id,
        channelId,
        kind: 'phone',
        value: phone,
      },
    });
    const created = await prisma.conversation.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        kind: 'CUSTOMER',
        access: 'tenant',
        channelId,
        contactId: contact.id,
        customerLastMessageAt: opts.customerAt ?? null,
      },
    });
    return { id: created.id, phone };
  }

  const text = (id: string, body: string, cid = randomUUID()) =>
    http()
      .post(`/api/conversations/${id}/messages`)
      .set(agent.headers)
      .send({ body, clientMessageId: cid });
  const template = (id: string, body: Record<string, unknown> = {}, cid = randomUUID()) =>
    http()
      .post(`/api/conversations/${id}/template-messages`)
      .set(agent.headers)
      .send({ name: 'hello_world', language: 'en_US', clientMessageId: cid, ...body });
  const row = (id: string) => prisma.chatMessage.findUniqueOrThrow({ where: { id } });
  const deliver = (id: string) =>
    tenantContext.runWith(DEFAULT_TENANT_ID, () => delivery.deliver(id));
  const logs = () =>
    prisma.channelLog.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });

  // ------------------------------------------------------- вікно (6.1)

  describe('вікно під контролем провайдера (6.1)', () => {
    it('текст у розмову без жодного вхідного на Meta-каналі приймається й ставиться в чергу; картка показує canReply', async () => {
      const { id } = await conversation({ customerAt: null });

      const card = await http().get(`/api/conversations/${id}`).set(agent.headers).expect(200);
      expect(card.body).toMatchObject({
        canReply: true,
        replyWindowEndsAt: null,
        contact: { deliveryReceipts: false },
      });

      const res = await text(id, 'Добрий день').expect(201);
      expect((res.body as MessageBody).status).toBe('QUEUED');
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });

    it('той самий текст на fake-каналі без вхідного — як і раніше 422 CHANNEL_WINDOW_CLOSED', async () => {
      const fakeAccount = await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'fake',
          name: 'send e2e fake',
          verifyToken: 'v',
          webhookKey: randomBytes(16).toString('hex'),
        },
      });
      const fakeChannel = await prisma.channel.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId: fakeAccount.id,
          type: 'WHATSAPP',
          provider: 'fake',
          externalId: `fk-${randomUUID()}`,
          isEnabled: true,
        },
      });
      const contact = await prisma.channelContact.create({
        data: { tenantId: DEFAULT_TENANT_ID, channelId: fakeChannel.id },
      });
      const conv = await prisma.conversation.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          kind: 'CUSTOMER',
          access: 'tenant',
          channelId: fakeChannel.id,
          contactId: contact.id,
        },
      });

      const res = await text(conv.id, 'x').expect(422);
      expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
      await prisma.conversation.delete({ where: { id: conv.id } });
    });

    it('коли вхідне відоме й старе — локальне правило діє й на Meta-каналі: 422', async () => {
      const { id } = await conversation({ customerAt: new Date(Date.now() - 30 * 3_600_000) });
      const res = await text(id, 'запізно').expect(422);
      expect((res.body as { code: string }).code).toBe('CHANNEL_WINDOW_CLOSED');
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
    });
  });

  // ------------------------------------------------------- шаблон (6.2)

  describe('шаблон (6.2)', () => {
    it('приймається в чергу з payload; body — імʼя; відповідь не містить вікна; доставка ставиться з ключем розмови', async () => {
      const { id } = await conversation({ customerAt: null });

      const res = await template(id).expect(201);
      const message = res.body as MessageBody;

      expect(message).toMatchObject({
        status: 'QUEUED',
        body: 'hello_world',
        direction: 'OUTBOUND',
        senderId: agent.id,
      });
      expect(message.payload).toEqual({ template: { name: 'hello_world', language: 'en_US' } });
      const jobs = sentJobs.forQueue(DELIVER_QUEUE);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.options).toMatchObject({ singletonKey: id });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(
        agent.id,
      );
    });

    it('поза вікном і без вхідного — приймається; повтор і гонка дають одну доставку', async () => {
      const { id } = await conversation({ customerAt: new Date(Date.now() - 72 * 3_600_000) });
      const cid = randomUUID();

      const [a, b] = await Promise.all([template(id, {}, cid), template(id, {}, cid)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect((a.body as MessageBody).id).toBe((b.body as MessageBody).id);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);

      await template(id, {}, cid).expect(201);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });

    it('невалідне імʼя чи мова — 400; чужа/внутрішня розмова — 404; вимкнений або зниклий канал — 409', async () => {
      const { id } = await conversation();
      await template(id, { name: 'Hello World' }).expect(400);
      await template(id, { language: 'english' }).expect(400);

      const peer = await createAndLoginTestUser(app, prisma, {
        email: `wa-send-peer-${String(Date.now())}@example.com`,
        password: 'SecurePass123',
        name: 'peer',
        role: 'USER',
      });
      userIds.push(peer.user.id);
      const internal = await http()
        .post('/api/conversations')
        .set(agent.headers)
        .send({ participantUserIds: [peer.user.id] })
        .expect(201);
      await template((internal.body as { id: string }).id).expect(404);

      await prisma.channel.update({ where: { id: channelId }, data: { isEnabled: false } });
      await template(id).expect(409);
      await text(id, 'x').expect(409);
      await prisma.channel.update({
        where: { id: channelId },
        data: { isEnabled: true, providerMissingAt: new Date() },
      });
      await template(id).expect(409);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(0);
    });

    it('невдалий шаблон можна повторити, коли вікно закрите (повтор шаблону вікна не потребує)', async () => {
      const { id } = await conversation({ customerAt: null });
      const message = (await template(id).expect(201)).body as MessageBody;
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED', failure: { class: 'PERMANENT', code: '132001', title: 'x' } },
      });
      sentJobs.reset();

      await http()
        .post(`/api/conversations/${id}/messages/${message.id}/resend`)
        .set(agent.headers)
        .expect(201);
      expect(sentJobs.forQueue(DELIVER_QUEUE)).toHaveLength(1);
    });
  });

  // ------------------------------------- доставка через справжній адаптер (6.3)

  describe('доставка через MetaCloudAdapter проти стаба (6.3)', () => {
    async function queued(
      opts: { customerAt?: Date | null; template?: boolean; body?: string } = {},
    ): Promise<{ id: string; messageId: string; phone: string }> {
      const conv = await conversation({ customerAt: opts.customerAt ?? null });
      const message = await prisma.chatMessage.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conv.id,
          seq: 1,
          kind: 'TEXT',
          status: 'QUEUED',
          senderType: 'user',
          senderUserId: agent.id,
          body: opts.template ? 'hello_world' : (opts.body ?? 'Привіт'),
          ...(opts.template && {
            payload: { template: { name: 'hello_world', language: 'en_US' } },
          }),
          direction: 'OUTBOUND',
          channelId,
        },
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastSeq: 1 } });
      return { id: conv.id, messageId: message.id, phone: conv.phone };
    }

    it('текст: стаб отримує type=text, адресата цифрами й токен у заголовку; повідомлення SENT з id провайдера, один запис журналу', async () => {
      stub.route('POST', `${PHONE_ID}/messages`, sendOk('wamid.TEXT1'));
      const { messageId, phone } = await queued({ body: 'Секретний зміст' });

      await deliver(messageId);

      const m = await row(messageId);
      expect(m).toMatchObject({ status: 'SENT', externalId: 'wamid.TEXT1', attempts: 1 });
      const [call] = stub.requests;
      expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call?.url).not.toContain(TOKEN);
      expect(call?.body).toMatchObject({
        type: 'text',
        to: phone,
        text: { body: 'Секретний зміст' },
        biz_opaque_callback_data: messageId,
      });

      const [entry] = await logs();
      expect(entry).toMatchObject({ operation: 'send', ok: true, messageId });
      expect(JSON.stringify(await logs())).not.toContain('Секретний');
      expect(JSON.stringify(await logs())).not.toContain(phone);
    });

    it('шаблон поза вікном: стаб отримує type=template з імʼям і мовою, вікно не перевіряється', async () => {
      stub.route('POST', `${PHONE_ID}/messages`, {
        body: { messages: [{ id: 'wamid.TPL', message_status: 'accepted' }] },
      });
      const { messageId } = await queued({
        template: true,
        customerAt: new Date(Date.now() - 100 * 3_600_000),
      });

      await deliver(messageId);

      expect(await row(messageId)).toMatchObject({ status: 'SENT', externalId: 'wamid.TPL' });
      expect(stub.requests[0]?.body).toMatchObject({
        type: 'template',
        template: { name: 'hello_world', language: { code: 'en_US' } },
      });
    });

    it('текст, коли вхідне відоме й старе: FAILED(WINDOW_CLOSED) без виклику Meta', async () => {
      const { messageId } = await queued({ customerAt: new Date(Date.now() - 30 * 3_600_000) });
      await deliver(messageId);

      expect(stub.requests).toHaveLength(0);
      expect((await row(messageId)).failure).toMatchObject({ class: 'WINDOW_CLOSED' });
    });

    it('131047 від Meta → FAILED(WINDOW_CLOSED) з кодом провайдера', async () => {
      stub.route('POST', `${PHONE_ID}/messages`, graphError(131047, 'Re-engagement message', 400));
      const { messageId } = await queued();
      await deliver(messageId);

      const m = await row(messageId);
      expect(m.status).toBe('FAILED');
      expect(m.failure).toMatchObject({ class: 'WINDOW_CLOSED', code: '131047' });
      expect((await logs())[0]).toMatchObject({ ok: false, errorCode: '131047', httpStatus: 400 });
    });

    it('190 → FAILED(AUTH) і акаунт «потрібна повторна авторизація»; текст помилки без токена', async () => {
      stub.route(
        'POST',
        `${PHONE_ID}/messages`,
        graphError(190, `Error validating access token ${TOKEN.slice(0, 24)}`, 401),
      );
      const { messageId } = await queued();
      await deliver(messageId);

      expect((await row(messageId)).failure).toMatchObject({ class: 'AUTH', code: '190' });
      expect(
        (await prisma.messagingAccount.findUniqueOrThrow({ where: { id: accountId } })).status,
      ).toBe('NEEDS_REAUTH');
      expect(JSON.stringify(await logs())).not.toContain(TOKEN.slice(0, 24));
    });

    it('130429 повторюється й потім проходить; 5xx повторюється до межі й стає FAILED(TRANSIENT)', async () => {
      let calls = 0;
      stub.route('POST', `${PHONE_ID}/messages`, () =>
        calls++ === 0 ? graphError(130429, 'rate', 429) : sendOk('wamid.RETRY'),
      );
      const rate = await queued();
      await expect(deliver(rate.messageId)).rejects.toBeInstanceOf(RetryableDeliveryError);
      expect((await row(rate.messageId)).status).toBe('QUEUED');
      await deliver(rate.messageId);
      expect(await row(rate.messageId)).toMatchObject({
        status: 'SENT',
        attempts: 2,
        externalId: 'wamid.RETRY',
      });

      stub.reset();
      stub.route('POST', `${PHONE_ID}/messages`, graphError(1, 'server down', 500));
      const down = await queued();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expect(deliver(down.messageId)).rejects.toBeInstanceOf(RetryableDeliveryError);
      }
      await deliver(down.messageId);
      expect(await row(down.messageId)).toMatchObject({ status: 'FAILED', attempts: 5 });
      expect((await row(down.messageId)).failure).toMatchObject({ class: 'TRANSIENT' });
    });

    it('131030 → FAILED(PERMANENT) із заголовком про список дозволених отримувачів', async () => {
      stub.route(
        'POST',
        `${PHONE_ID}/messages`,
        graphError(131030, 'Recipient phone number not in allowed list', 400),
      );
      const { messageId } = await queued();
      await deliver(messageId);

      const m = await row(messageId);
      expect(m.failure).toMatchObject({ class: 'PERMANENT', code: '131030' });
      expect((m.failure as { title: string }).title).toMatch(/allowed list/);
    });

    it('шаблон, що вимагає змінних: 132000 → PERMANENT, причина Meta показана', async () => {
      stub.route(
        'POST',
        `${PHONE_ID}/messages`,
        graphError(132000, 'Number of parameters does not match', 400),
      );
      const { messageId } = await queued({ template: true });
      await deliver(messageId);
      expect((await row(messageId)).failure).toMatchObject({ class: 'PERMANENT', code: '132000' });
    });

    it('відповідь 2xx без id повідомлення — не «успіх»: повторюється як тимчасова', async () => {
      stub.route('POST', `${PHONE_ID}/messages`, { body: { messages: [] } });
      const { messageId } = await queued();
      await expect(deliver(messageId)).rejects.toBeInstanceOf(RetryableDeliveryError);
      expect((await row(messageId)).status).toBe('QUEUED');
    });

    it('відключений акаунт (токена немає) — FAILED(AUTH) без жодного виклику Meta', async () => {
      await prisma.messagingAccount.update({
        where: { id: accountId },
        data: { credentials: null, status: 'DISABLED' },
      });
      const { messageId } = await queued();
      await deliver(messageId);

      expect(stub.requests).toHaveLength(0);
      expect((await row(messageId)).failure).toMatchObject({
        class: 'AUTH',
        code: 'no_credentials',
      });
    });
  });
});
