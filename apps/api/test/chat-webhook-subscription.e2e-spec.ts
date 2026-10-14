/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaService } from '@saas-skeleton/database';
import { CryptoService } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  GraphStub,
  graphError,
  type StubRequest,
} from '../../../libs/shared/src/channels/meta-cloud/testing/graph-stub';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3b1: куди йдуть вебхуки номера, явна підписка/відписка, захоплені події — проти Graph-стаба.

const TENANT_B_ID = '00000000-0000-4000-8000-00000000004a';
const PHONE_ID = '109000000000777';
const TOKEN = 'EAAGsubscribeTOKENvalueABCDEFGHIJKLMNOP1234567890xyz';
const VERIFY_TOKEN = 'verify-token-sub-e2e';
const BASE = 'https://stand.example.test';
const FMS = 'https://fms-dev.example.test:8443/api/public/webhooks/whatsapp?k=SECRETKEY';

interface Person {
  id: string;
  headers: { Authorization: string };
}
interface StatusBody {
  state: 'ours' | 'none' | 'elsewhere';
  level: string | null;
  host: string | null;
  configured: { phoneNumber: string | null; whatsappBusinessAccount: string | null; application: string | null };
  address: string | null;
  subscribedAt: string | null;
}

describe('Webhook subscription and captured events (e2e, CHAT-3b1)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let admin: Person;
  let plainUser: Person;
  let accountId: string;
  let channelId: string;
  let key: string;
  let address: string;
  /** Що Meta «зберігає» для номера; стаб читає й міняє це, як справжній Graph */
  let config: Record<string, string>;
  const stub = new GraphStub();
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const base = '/api/settings/messaging';
  const status = (who = admin, id = channelId) => http().get(`${base}/channels/${id}/webhook`).set(who.headers);
  const subscribe = (body: Record<string, unknown> = {}, who = admin, id = channelId) =>
    http().post(`${base}/channels/${id}/webhook/subscribe`).set(who.headers).send(body);
  const unsubscribe = (who = admin, id = channelId) =>
    http().post(`${base}/channels/${id}/webhook/unsubscribe`).set(who.headers).send({});
  const writes = (): StubRequest[] => stub.requests.filter((r) => r.method === 'POST' && r.path === PHONE_ID);

  beforeAll(async () => {
    process.env.META_GRAPH_BASE_URL = await stub.start();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({ where: { id: TENANT_B_ID }, update: {}, create: { id: TENANT_B_ID, slug: 'wa-sub-b', name: 'WA subscription tenant B' } });
    const make = async (prefix: string, role: 'ADMIN' | 'USER'): Promise<Person> => {
      const { user, tokens } = await createAndLoginTestUser(app, prisma, {
        email: `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
        password: 'SecurePass123',
        name: prefix,
        role,
      });
      userIds.push(user.id);
      return { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
    };
    admin = await make('wh-admin', 'ADMIN');
    plainUser = await make('wh-user', 'USER');
  });

  beforeEach(async () => {
    process.env.CHANNEL_WEBHOOK_BASE_URL = BASE;
    stub.reset();
    config = {};
    stub.route('GET', PHONE_ID, () => ({ body: { id: PHONE_ID, webhook_configuration: { ...config } } }));
    stub.route('POST', PHONE_ID, (req) => {
      const override = (req.body as { webhook_configuration?: { override_callback_uri?: string } }).webhook_configuration
        ?.override_callback_uri;
      if (override === '') delete config.phone_number;
      else if (override) config.phone_number = override;
      return { body: { success: true } };
    });
    key = randomBytes(16).toString('hex');
    address = `${BASE}/api/public/channels/meta_cloud/${key}`;
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'webhook sub e2e',
          externalId: '1000000000777',
          credentials: app.get(CryptoService).encrypt(TOKEN),
          verifyToken: VERIFY_TOKEN,
          webhookKey: key,
        },
      })
    ).id;
    channelId = (
      await prisma.channel.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId, type: 'WHATSAPP', provider: 'meta_cloud', externalId: PHONE_ID, displayPhoneNumber: '+1 555 000 0777', isEnabled: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.messagingAccount.deleteMany({ where: { provider: { in: ['meta_cloud', 'fake'] }, name: { in: ['webhook sub e2e', 'webhook sub e2e B', 'webhook sub e2e fake'] } } });
  });

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    delete process.env.CHANNEL_WEBHOOK_BASE_URL;
    await stub.stop();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  describe('читання', () => {
    it('нічого не налаштовано → none', async () => {
      const res = await status().expect(200);
      expect(res.body).toMatchObject({ state: 'none', level: null, host: null, address, subscribedAt: null });
    });

    it('чужий хост на рівні WABA → elsewhere з хостом, без повної адреси й секретного ключа', async () => {
      config = { whatsapp_business_account: FMS, application: FMS };
      const res = await status().expect(200);
      const body = res.body as StatusBody;
      expect(body).toMatchObject({ state: 'elsewhere', level: 'whatsapp_business_account', host: 'fms-dev.example.test:8443' });
      expect(body.configured).toEqual({ phoneNumber: null, whatsappBusinessAccount: 'fms-dev.example.test:8443', application: 'fms-dev.example.test:8443' });
      expect(JSON.stringify(body)).not.toContain('SECRETKEY');
      expect(JSON.stringify(body)).not.toContain('webhooks/whatsapp');
    });

    it('рівень номера має пріоритет; збіг з нашою адресою → ours', async () => {
      config = { whatsapp_business_account: FMS, phone_number: address };
      const res = await status().expect(200);
      expect(res.body).toMatchObject({ state: 'ours', level: 'phone_number', host: 'stand.example.test' });
    });

    it('токен ходить лише в заголовку', async () => {
      await status().expect(200);
      expect(stub.requests.every((r) => r.headers.authorization === `Bearer ${TOKEN}` && !r.url.includes(TOKEN))).toBe(true);
    });
  });

  describe('підписка', () => {
    it('з none: ставить нашу адресу з verify token, читає назад, записує час; у журналі без verify token', async () => {
      const res = await subscribe().expect(200);
      expect(res.body).toMatchObject({ state: 'ours', level: 'phone_number' });
      expect((res.body as StatusBody).subscribedAt).not.toBeNull();

      const [write] = writes();
      expect(write?.body).toEqual({ webhook_configuration: { override_callback_uri: address, verify_token: VERIFY_TOKEN } });
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).webhookSubscribedAt).not.toBeNull();

      const logs = await prisma.channelLog.findMany({ where: { accountId, operation: 'webhook' } });
      expect(logs.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(logs)).not.toContain(VERIFY_TOKEN);
      expect(JSON.stringify(logs)).not.toContain(TOKEN);
      // квитанцій як не було, так і немає: вебхук лише захоплюється
      const channels = await http().get('/api/chat/channels').set(admin.headers).expect(200);
      const item = (channels.body as { items: { id: string; deliveryReceipts: boolean }[] }).items.find((c) => c.id === channelId);
      expect(item?.deliveryReceipts).toBe(false);
    });

    it('чужі події: без назви хоста 409 і жодного запису в Meta; з чужою назвою 409; з правильною — підписано', async () => {
      config = { whatsapp_business_account: FMS };
      await subscribe().expect(409);
      await subscribe({ replaceHost: 'other.example.test' }).expect(409);
      expect(writes()).toHaveLength(0);

      const res = await subscribe({ replaceHost: 'fms-dev.example.test:8443' }).expect(200);
      expect(res.body).toMatchObject({ state: 'ours' });
      expect(writes()).toHaveLength(1);
      // рівень WABA (fms) не чіпали — лише номер
      expect(config.whatsapp_business_account).toBe(FMS);
    });

    it('без публічної бази — 409, Meta не викликається', async () => {
      delete process.env.CHANNEL_WEBHOOK_BASE_URL;
      await subscribe().expect(409);
      expect(stub.requests).toHaveLength(0);
    });

    it('Meta не змогла перевірити адресу (рукостискання) → 422 з причиною Meta, час не записано', async () => {
      stub.route('POST', PHONE_ID, graphError(100, 'The callback URL or verify token could not be validated', 400));
      const res = await subscribe().expect(422);
      expect(JSON.stringify(res.body)).toContain('could not be validated');
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).webhookSubscribedAt).toBeNull();
    });

    it('Meta відповіла успіхом, але адреса не застосувалась → 422, час не записано', async () => {
      stub.route('POST', PHONE_ID, { body: { success: true } });
      await subscribe().expect(422);
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).webhookSubscribedAt).toBeNull();
    });
  });

  describe('відписка', () => {
    it('знімає лише наш override; події повертаються на рівень вище; час очищено', async () => {
      config = { whatsapp_business_account: FMS };
      await subscribe({ replaceHost: 'fms-dev.example.test:8443' }).expect(200);

      const res = await unsubscribe().expect(200);
      expect(res.body).toMatchObject({ state: 'elsewhere', level: 'whatsapp_business_account', subscribedAt: null });
      expect(writes().at(-1)?.body).toEqual({ webhook_configuration: { override_callback_uri: '' } });
      expect(config.whatsapp_business_account).toBe(FMS);
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).webhookSubscribedAt).toBeNull();
    });
  });

  describe('доступ', () => {
    it('не адмін — 403 на всі маршрути; чужий тенант — 404; fake-канал — 409', async () => {
      await status(plainUser).expect(403);
      await subscribe({}, plainUser).expect(403);
      await unsubscribe(plainUser).expect(403);
      await http().get(`${base}/accounts/${accountId}/webhook-events`).set(plainUser.headers).expect(403);

      const foreignAccount = await prisma.messagingAccount.create({
        data: { tenantId: TENANT_B_ID, provider: 'meta_cloud', name: 'webhook sub e2e B', credentials: app.get(CryptoService).encrypt(TOKEN), verifyToken: 'v', webhookKey: randomBytes(16).toString('hex') },
      });
      const foreign = await prisma.channel.create({
        data: { tenantId: TENANT_B_ID, accountId: foreignAccount.id, type: 'WHATSAPP', provider: 'meta_cloud', externalId: 'foreign-phone', isEnabled: true },
      });
      await status(admin, foreign.id).expect(404);
      await subscribe({}, admin, foreign.id).expect(404);
      await http().get(`${base}/accounts/${foreignAccount.id}/webhook-events`).set(admin.headers).expect(404);

      const fakeAccount = await prisma.messagingAccount.create({
        data: { tenantId: DEFAULT_TENANT_ID, provider: 'fake', name: 'webhook sub e2e fake', verifyToken: 'v', webhookKey: randomBytes(16).toString('hex') },
      });
      const fake = await prisma.channel.create({
        data: { tenantId: DEFAULT_TENANT_ID, accountId: fakeAccount.id, type: 'WHATSAPP', provider: 'fake', externalId: `fk-${randomUUID()}`, isEnabled: true },
      });
      await status(admin, fake.id).expect(409);
      expect(stub.requests).toHaveLength(0);
    });
  });

  describe('захоплені події', () => {
    const add = (n: number, over: Record<string, unknown> = {}) =>
      prisma.channelWebhookEvent.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          accountId,
          body: `{"n":${String(n)}}`,
          payloadHash: `h-${String(n)}-${randomUUID()}`,
          receivedAt: new Date(Date.now() - (10 - n) * 1000),
          headers: { 'x-hub-signature-256': `sha256=${String(n)}` },
          signatureValid: n % 2 === 0,
          ...over,
        },
      });

    it('новіші спершу з тілом, заголовками й підписом; сторінки по курсору без повторів', async () => {
      for (let n = 1; n <= 5; n += 1) await add(n);

      const first = await http().get(`${base}/accounts/${accountId}/webhook-events?limit=2`).set(admin.headers).expect(200);
      const firstBody = first.body as { items: { body: string; headers: Record<string, string>; signatureValid: boolean | null; state: string }[]; nextCursor: string | null };
      expect(firstBody.items.map((e) => e.body)).toEqual(['{"n":5}', '{"n":4}']);
      expect(firstBody.items[0]?.headers['x-hub-signature-256']).toBe('sha256=5');
      expect(firstBody.items.map((e) => e.signatureValid)).toEqual([false, true]);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await http().get(`${base}/accounts/${accountId}/webhook-events?limit=10&cursor=${firstBody.nextCursor ?? ''}`).set(admin.headers).expect(200);
      const secondBody = second.body as { items: { body: string }[]; nextCursor: string | null };
      expect(secondBody.items.map((e) => e.body)).toEqual(['{"n":3}', '{"n":2}', '{"n":1}']);
      expect(secondBody.nextCursor).toBeNull();
    });

    it('подія без збережених заголовків (до цієї зміни) віддається з порожніми', async () => {
      await add(1, { headers: undefined, signatureValid: null });
      const res = await http().get(`${base}/accounts/${accountId}/webhook-events`).set(admin.headers).expect(200);
      expect((res.body as { items: { headers: unknown; signatureValid: unknown }[] }).items[0]).toMatchObject({ headers: {}, signatureValid: null });
    });
  });
});
