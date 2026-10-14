/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Redis } from 'ioredis';
import { SystemPrismaService } from '@saas-skeleton/database';
import { CryptoService } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  GraphStub,
  graphError,
  healthyAccountRoutes,
  type StubRequest,
} from '../../../libs/shared/src/channels/meta-cloud/testing/graph-stub';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// CHAT-3a: підключення WhatsApp Business, перевірка токена, синхронізація номерів, канали й журнал — проти
// локального Graph-стаба (без мережі). Секрети перевіряються на КОЖНІЙ відповіді й у КОЖНОМУ запиті стаба.

const TENANT_B_ID = '00000000-0000-4000-8000-000000000048';
const WABA = '1000000000001';
const APP_ID = '555000111';
const APP_SECRET = 'app-secret-value-0123456789abcdef';
const TOKEN = 'EAAGconnectTOKENvalueABCDEFGHIJKLMNOP1234567890xyzW';

interface Person {
  id: string;
  headers: { Authorization: string };
}

interface AccountBody {
  id: string;
  status: string;
  name: string;
  credentialsSet: boolean;
  appSecretSet: boolean;
  appIdSet: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  token: { mask: string; kind: string; expiresAt: string | null; scopes: string[]; verified: boolean } | null;
  channels: {
    id: string;
    isEnabled: boolean;
    isDefault: boolean;
    isMissing: boolean;
    displayPhoneNumber: string | null;
    qualityRating: string | null;
    mode: string | null;
    nameStatus: string | null;
    deliveryReceipts: boolean;
  }[];
}

const phone = (id: string, display: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_phone_number: display,
  verified_name: `Name ${id}`,
  quality_rating: 'GREEN',
  name_status: 'APPROVED',
  status: 'CONNECTED',
  account_mode: 'LIVE',
  code_verification_status: 'NOT_VERIFIED',
  platform_type: 'CLOUD_API',
  throughput: { level: 'STANDARD' },
  ...extra,
});

describe('WhatsApp connection (e2e, CHAT-3a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let admin: Person;
  let plainUser: Person;
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
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'wa-conn-b', name: 'WA connection tenant B' },
    });
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
    admin = await make('wa-admin', 'ADMIN');
    plainUser = await make('wa-user', 'USER');
  });

  beforeEach(() => {
    stub.reset();
    healthyAccountRoutes(stub, { waba: WABA, appId: APP_ID });
    stub.route('GET', `${WABA}/phone_numbers`, {
      body: { data: [phone('111', '+1 555 000 0111'), phone('222', '+1 555 000 0222')] },
    });
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { channel: { provider: 'meta_cloud' } } });
    await prisma.messagingAccount.deleteMany({ where: { provider: 'meta_cloud', tenantId: { in: [DEFAULT_TENANT_ID, TENANT_B_ID] } } });
  });

  afterAll(async () => {
    delete process.env.META_GRAPH_BASE_URL;
    await stub.stop();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const connect = (body: Record<string, unknown> = {}, who: Person = admin) =>
    http()
      .post('/api/settings/messaging/accounts')
      .set(who.headers)
      .send({ provider: 'meta_cloud', wabaId: WABA, accessToken: TOKEN, appId: APP_ID, appSecret: APP_SECRET, ...body });

  const accountOf = async (): Promise<AccountBody> =>
    (((await http().get('/api/settings/messaging').set(admin.headers).expect(200)).body as { items: AccountBody[] }).items.find(
      (a) => (a as unknown as { provider: string }).provider === 'meta_cloud',
    ) as AccountBody);

  /** Жоден секрет не може бути в тексті відповіді, в якому б вигляді його не віддали */
  const expectNoSecrets = (payload: unknown): void => {
    const text = JSON.stringify(payload);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(TOKEN.slice(0, 20));
    expect(text).not.toContain(APP_SECRET);
  };

  /**
   * І жоден запит до Graph не несе токен чи секрет у URL або тілі. ЄДИНИЙ виняток — `input_token` у query
   * самого `debug_token`: Graph API вимагає його саме там (документований контракт), а bearer цього виклику
   * — app-токен. Клієнт не логує query, тож у журнал він не потрапляє.
   */
  const expectTokenOnlyInHeaders = (requests: readonly StubRequest[]): void => {
    for (const r of requests) {
      if (r.path !== 'debug_token') expect(r.url).not.toContain(TOKEN);
      expect(r.url).not.toContain(APP_SECRET);
      expect(JSON.stringify(r.body ?? '')).not.toContain(TOKEN);
    }
  };

  describe('підключення (5.1)', () => {
    it('валідний токен: збережено, вид/строк/права від Meta, імʼя з WABA, номери синхронізовано, секретів немає ніде', async () => {
      const res = await connect().expect(201);
      const body = res.body as AccountBody;

      expect(body).toMatchObject({
        status: 'CONNECTED',
        name: 'Test WhatsApp Business Account',
        credentialsSet: true,
        appSecretSet: true,
        appIdSet: true,
        lastError: null,
      });
      expect(body.token).toMatchObject({ kind: 'SYSTEM_USER', expiresAt: null, verified: true });
      expect(body.token?.scopes).toEqual(expect.arrayContaining(['whatsapp_business_management', 'whatsapp_business_messaging']));
      expect(body.token?.mask).toBe(`••••${TOKEN.slice(-4)}`);
      expect(body.channels).toHaveLength(2);
      expect(body.channels.every((c) => !c.isEnabled && !c.isDefault && !c.isMissing)).toBe(true);
      expect(body.channels.map((c) => c.displayPhoneNumber).sort()).toEqual(['+1 555 000 0111', '+1 555 000 0222']);
      expect(body.channels[0]).toMatchObject({ qualityRating: 'GREEN', mode: 'LIVE', nameStatus: 'APPROVED', deliveryReceipts: false });
      expect(body.lastSyncAt).not.toBeNull();

      expectNoSecrets(body);
      expectNoSecrets((await http().get('/api/settings/messaging').set(admin.headers).expect(200)).body);
      expectTokenOnlyInHeaders(stub.requests);
      // debug_token іде з app-токеном `APP_ID|APP_SECRET`, а перевіряється токен у query — і лише в заголовку bearer
      const debug = stub.requests.find((r) => r.path === 'debug_token');
      expect(debug?.headers.authorization).toBe(`Bearer ${APP_ID}|${APP_SECRET}`);
      expect(debug?.query.input_token).toBe(TOKEN);
      // у БД токен зашифровано
      const row = await prisma.messagingAccount.findFirstOrThrow({ where: { provider: 'meta_cloud' } });
      expect(row.credentials).not.toBeNull();
      expect(row.credentials).not.toContain(TOKEN);
      expect(app.get(CryptoService).decrypt(row.credentials ?? '')).toBe(TOKEN);
    });

    it('без права messaging: 400, поле accessToken, код token_missing_scope і назва права; нічого не збережено', async () => {
      stub.route('GET', 'debug_token', {
        body: { data: { app_id: APP_ID, type: 'SYSTEM_USER', is_valid: true, expires_at: 0, scopes: ['whatsapp_business_management'] } },
      });
      const res = await connect().expect(400);
      const field = (res.body as { fieldErrors: { field: string; code: string; params?: { scope: string } }[] }).fieldErrors[0];
      expect(field).toMatchObject({ field: 'accessToken', code: 'token_missing_scope', params: { scope: 'whatsapp_business_messaging' } });
      expect(await prisma.messagingAccount.count({ where: { provider: 'meta_cloud' } })).toBe(0);
    });

    it('токен без доступу до WABA: 400, поле wabaId, код waba_no_access; нічого не збережено', async () => {
      stub.route('GET', WABA, graphError(100, 'Unsupported get request', 400));
      const res = await connect().expect(400);
      expect((res.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0]).toMatchObject({ field: 'wabaId', code: 'waba_no_access' });
      expect(await prisma.messagingAccount.count({ where: { provider: 'meta_cloud' } })).toBe(0);
    });

    it('недійсний токен (is_valid=false) і 190: 400 token_invalid, токен не повторюється у відповіді', async () => {
      stub.route('GET', 'debug_token', { body: { data: { app_id: APP_ID, is_valid: false, scopes: [] } } });
      const first = await connect().expect(400);
      expect((first.body as { fieldErrors: { code: string }[] }).fieldErrors[0]?.code).toBe('token_invalid');
      expectNoSecrets(first.body);

      stub.reset();
      stub.route('GET', WABA, graphError(190, `Invalid OAuth access token ${TOKEN.slice(0, 24)}`, 401));
      const second = await connect({ appId: undefined, appSecret: undefined }).expect(400);
      expect((second.body as { fieldErrors: { code: string }[] }).fieldErrors[0]?.code).toBe('token_invalid');
      expectNoSecrets(second.body);
      expect(await prisma.messagingAccount.count({ where: { provider: 'meta_cloud' } })).toBe(0);
    });

    it('чужий застосунок і хибний секрет: окремі коди на appId / appSecret', async () => {
      stub.route('GET', 'debug_token', {
        body: { data: { app_id: '999', is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } },
      });
      const wrongApp = await connect().expect(400);
      expect((wrongApp.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0]).toMatchObject({ field: 'appId', code: 'token_wrong_app' });

      stub.reset();
      stub.route('GET', 'debug_token', graphError(190, 'Invalid OAuth access token - Cannot parse access token', 400));
      const badSecret = await connect().expect(400);
      expect((badSecret.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0]).toMatchObject({ field: 'appSecret', code: 'app_secret_invalid' });
      expectNoSecrets(badSecret.body);
    });

    it('без app secret: підключено, але вид і права «не перевірено»', async () => {
      const res = await connect({ appId: undefined, appSecret: undefined }).expect(201);
      const body = res.body as AccountBody;
      expect(body.token).toMatchObject({ kind: 'UNKNOWN', verified: false, scopes: [], expiresAt: null });
      expect(body.appSecretSet).toBe(false);
      expect(stub.requests.some((r) => r.path === 'debug_token')).toBe(false);
    });

    it('тимчасовий токен показує строк дії', async () => {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      stub.route('GET', 'debug_token', {
        body: { data: { app_id: APP_ID, type: 'USER', is_valid: true, expires_at: expires, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } },
      });
      const body = (await connect().expect(201)).body as AccountBody;
      expect(body.token?.kind).toBe('USER');
      expect(new Date(body.token?.expiresAt ?? 0).getTime()).toBe(expires * 1000);
    });

    it('збій провайдера під час перевірки — 503 і нічого не збережено', async () => {
      stub.route('GET', WABA, graphError(1, 'boom', 500));
      await connect().expect(503);
      expect(await prisma.messagingAccount.count({ where: { provider: 'meta_cloud' } })).toBe(0);
    });

    it('другий запит на підключення — 409; не-адмін — 403; два одночасні — один 201 і один 409', async () => {
      await connect().expect(201);
      await connect().expect(409);
      await connect({}, plainUser).expect(403);

      await prisma.messagingAccount.deleteMany({ where: { provider: 'meta_cloud' } });
      const results = await Promise.all([connect(), connect()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.messagingAccount.count({ where: { provider: 'meta_cloud' } })).toBe(1);
    });

    it('невалідне тіло (WABA не з цифр, лише app id без секрету) — 400 до будь-якого виклику Meta', async () => {
      await connect({ wabaId: 'abc' }).expect(400);
      await connect({ appSecret: undefined }).expect(400);
      expect(stub.requests).toHaveLength(0);
    });
  });

  describe('оновлення токена й відключення (5.1)', () => {
    it('новий токен повертає акаунт у CONNECTED і не чіпає канали та розмови; поганий — старий лишається', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const channel = await prisma.channel.findFirstOrThrow({ where: { accountId: account.id } });
      const contact = await prisma.channelContact.create({ data: { tenantId: DEFAULT_TENANT_ID, channelId: channel.id } });
      const conversation = await prisma.conversation.create({
        data: { tenantId: DEFAULT_TENANT_ID, kind: 'CUSTOMER', access: 'tenant', channelId: channel.id, contactId: contact.id },
      });
      await prisma.messagingAccount.update({ where: { id: account.id }, data: { status: 'NEEDS_REAUTH', lastError: 'old' } });
      const before = (await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } })).credentials;

      const newToken = `${TOKEN.slice(0, -4)}NEW1`;
      stub.reset();
      healthyAccountRoutes(stub, { waba: WABA, appId: APP_ID });
      const ok = await http().put(`/api/settings/messaging/accounts/${account.id}/credentials`).set(admin.headers).send({ accessToken: newToken }).expect(200);
      expect((ok.body as AccountBody).status).toBe('CONNECTED');
      expect((ok.body as AccountBody).lastError).toBeNull();
      // пару app id + секрет не повторювали — взято збережену
      expect(stub.requests.find((r) => r.path === 'debug_token')?.headers.authorization).toBe(`Bearer ${APP_ID}|${APP_SECRET}`);
      const after = await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(after.credentials).not.toBe(before);
      expect(app.get(CryptoService).decrypt(after.credentials ?? '')).toBe(newToken);
      expect(await prisma.channel.count({ where: { accountId: account.id } })).toBe(2);
      expect(await prisma.conversation.count({ where: { id: conversation.id } })).toBe(1);

      stub.reset();
      stub.route('GET', 'debug_token', { body: { data: { app_id: APP_ID, is_valid: false } } });
      await http().put(`/api/settings/messaging/accounts/${account.id}/credentials`).set(admin.headers).send({ accessToken: `${TOKEN.slice(0, -4)}BAD2` }).expect(400);
      expect((await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } })).credentials).toBe(after.credentials);
    });

    it('відключення: токен і секрет видалено, статус DISABLED, канали й розмови на місці', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const res = await http().post(`/api/settings/messaging/accounts/${account.id}/disconnect`).set(admin.headers).expect(200);

      expect(res.body).toMatchObject({ status: 'DISABLED', credentialsSet: false, appSecretSet: false, token: null });
      const row = await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(row).toMatchObject({ credentials: null, appSecret: null, status: 'DISABLED' });
      expect(await prisma.channel.count({ where: { accountId: account.id } })).toBe(2);
      // синхронізувати відключений акаунт не можна
      await http().post(`/api/settings/messaging/accounts/${account.id}/sync`).set(admin.headers).expect(409);
    });
  });

  describe('синхронізація номерів (5.2)', () => {
    it('повторна синхронізація нічого не змінює; новий номер з’являється вимкненим', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const again = await http().post(`/api/settings/messaging/accounts/${account.id}/sync`).set(admin.headers).expect(200);
      expect(again.body).toEqual({ created: 0, updated: 2, missing: 0, skipped: [] });
      expect(await prisma.channel.count({ where: { accountId: account.id } })).toBe(2);

      stub.route('GET', `${WABA}/phone_numbers`, { body: { data: [phone('111', '+1 555 000 0111'), phone('222', '+1 555 000 0222'), phone('333', '+1 555 000 0333')] } });
      const third = await http().post(`/api/settings/messaging/accounts/${account.id}/sync`).set(admin.headers).expect(200);
      expect(third.body).toMatchObject({ created: 1, updated: 2, missing: 0 });
      expect((await prisma.channel.findFirstOrThrow({ where: { externalId: '333' } })).isEnabled).toBe(false);
    });

    it('номер зник у Meta, у нього розмови: канал лишається з позначкою, розмова ціла, вмикати його не можна', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const channel = await prisma.channel.findFirstOrThrow({ where: { accountId: account.id, externalId: '222' } });
      const contact = await prisma.channelContact.create({ data: { tenantId: DEFAULT_TENANT_ID, channelId: channel.id } });
      const conversation = await prisma.conversation.create({
        data: { tenantId: DEFAULT_TENANT_ID, kind: 'CUSTOMER', access: 'tenant', channelId: channel.id, contactId: contact.id },
      });
      await prisma.channel.update({ where: { id: channel.id }, data: { isEnabled: true, isDefault: true } });

      stub.route('GET', `${WABA}/phone_numbers`, { body: { data: [phone('111', '+1 555 000 0111')] } });
      const res = await http().post(`/api/settings/messaging/accounts/${account.id}/sync`).set(admin.headers).expect(200);

      expect(res.body).toMatchObject({ missing: 1 });
      const after = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(after.providerMissingAt).not.toBeNull();
      expect(after.isEnabled).toBe(false);
      expect(after.isDefault).toBe(false);
      expect(await prisma.conversation.count({ where: { id: conversation.id } })).toBe(1);
      expect((await accountOf()).channels.find((c) => c.id === channel.id)?.isMissing).toBe(true);
      await http().patch(`/api/settings/messaging/channels/${channel.id}`).set(admin.headers).send({ isEnabled: true }).expect(409);
    });

    it('номер, що вже належить іншому тенанту, пропускається й повідомляється', async () => {
      const otherAccount = await prisma.messagingAccount.create({
        data: { tenantId: TENANT_B_ID, provider: 'meta_cloud', name: 'B', verifyToken: 'v', webhookKey: randomUUID().replace(/-/g, '') },
      });
      await prisma.channel.create({
        data: { tenantId: TENANT_B_ID, accountId: otherAccount.id, type: 'WHATSAPP', provider: 'meta_cloud', externalId: '222', displayPhoneNumber: '+1 other' },
      });

      const body = (await connect().expect(201)).body as AccountBody;

      expect(body.channels.map((c) => c.displayPhoneNumber)).toEqual(['+1 555 000 0111']);
      const sync = (await http().post(`/api/settings/messaging/accounts/${body.id}/sync`).set(admin.headers).expect(200)).body as { skipped: { externalId: string; reason: string }[] };
      expect(sync.skipped).toEqual([{ externalId: '222', reason: 'other_tenant' }]);
    });

    it('повний набір полів відхилено — повторюється мінімальним; дві сторінки читаються обидві', async () => {
      stub.route('GET', `${WABA}/phone_numbers`, (request) =>
        request.query.fields?.includes('name_status')
          ? graphError(100, '(#100) Tried accessing nonexisting field (name_status)', 400)
          : { body: { data: [{ id: '111', display_phone_number: '+1 555 000 0111', verified_name: 'N', quality_rating: 'GREEN' }] } },
      );
      const first = (await connect().expect(201)).body as AccountBody;
      expect(first.channels).toHaveLength(1);
      expect(first.channels[0]?.nameStatus).toBeNull();

      stub.route('GET', `${WABA}/phone_numbers`, (request) =>
        request.query.after
          ? { body: { data: [phone('222', '+1 555 000 0222')] } }
          : { body: { data: [phone('111', '+1 555 000 0111')], paging: { cursors: { after: 'CURSOR1' }, next: 'https://next' } } },
      );
      const sync = (await http().post(`/api/settings/messaging/accounts/${first.id}/sync`).set(admin.headers).expect(200)).body;
      expect(sync).toMatchObject({ created: 1, updated: 1 });
      expect(stub.requests.filter((r) => r.path === `${WABA}/phone_numbers`).some((r) => r.query.after === 'CURSOR1')).toBe(true);
    });

    it('токен недійсний під час синхронізації: 400, акаунт NEEDS_REAUTH, помилка збережена без секретів', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      stub.route('GET', `${WABA}/phone_numbers`, graphError(190, `Session expired ${TOKEN.slice(0, 24)}`, 401));

      await http().post(`/api/settings/messaging/accounts/${account.id}/sync`).set(admin.headers).expect(400);

      const row = await prisma.messagingAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(row.status).toBe('NEEDS_REAUTH');
      expect(row.lastError).not.toContain(TOKEN.slice(0, 24));
    });
  });

  describe('канали (5.3)', () => {
    it('вмикання, default і вимкнення default-номера', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const [a, b] = account.channels;
      const patch = (id: string | undefined, body: Record<string, unknown>) =>
        http().patch(`/api/settings/messaging/channels/${id ?? ''}`).set(admin.headers).send(body);

      await patch(a?.id, { isEnabled: true }).expect(200);
      const def = await patch(a?.id, { isDefault: true }).expect(200);
      expect(def.body).toMatchObject({ isEnabled: true, isDefault: true });
      await patch(b?.id, { isDefault: true }).expect(409); // вимкнений не може бути default

      await patch(b?.id, { isEnabled: true, isDefault: true }).expect(200);
      const channels = (await accountOf()).channels;
      expect(channels.find((c) => c.id === a?.id)?.isDefault).toBe(false);
      expect(channels.find((c) => c.id === b?.id)?.isDefault).toBe(true);

      const off = await patch(b?.id, { isEnabled: false }).expect(200);
      expect(off.body).toMatchObject({ isEnabled: false, isDefault: false });
      await patch(a?.id, {}).expect(400);
      await http().patch(`/api/settings/messaging/channels/${randomUUID()}`).set(admin.headers).send({ isEnabled: true }).expect(404);
    });

    it('два одночасні запити «зробити default» залишають рівно один default', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      const [a, b] = account.channels;
      await http().patch(`/api/settings/messaging/channels/${a?.id ?? ''}`).set(admin.headers).send({ isEnabled: true }).expect(200);
      await http().patch(`/api/settings/messaging/channels/${b?.id ?? ''}`).set(admin.headers).send({ isEnabled: true }).expect(200);

      await Promise.all(
        [a, b].map((c) => http().patch(`/api/settings/messaging/channels/${c?.id ?? ''}`).set(admin.headers).send({ isDefault: true })),
      );

      expect(await prisma.channel.count({ where: { accountId: account.id, isDefault: true } })).toBe(1);
    });

    it('не-адмін не змінює канали', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      await http().patch(`/api/settings/messaging/channels/${account.channels[0]?.id ?? ''}`).set(plainUser.headers).send({ isEnabled: true }).expect(403);
    });
  });

  describe('журнал (4.1, 5.4)', () => {
    it('після підключення є записи verify і sync; новіші спершу; без секретів; лише адміну; чужий тенант бачить 404', async () => {
      const account = (await connect().expect(201)).body as AccountBody;

      const res = await http().get(`/api/settings/messaging/accounts/${account.id}/logs`).set(admin.headers).expect(200);
      const items = (res.body as { items: { operation: string; ok: boolean; detail: Record<string, unknown>; createdAt: string }[] }).items;
      expect(items.map((i) => i.operation).sort()).toEqual(['sync', 'verify']);
      expect(items.every((i) => i.ok)).toBe(true);
      expect(items.find((i) => i.operation === 'sync')?.detail).toMatchObject({ pages: 1, numbers: 2, endpoint: `${WABA}/phone_numbers` });
      expect(new Date(items[0]?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(items[1]?.createdAt ?? 0).getTime());
      expectNoSecrets(res.body);

      await http().get(`/api/settings/messaging/accounts/${account.id}/logs`).set(plainUser.headers).expect(403);
      const email = `wa-b-${String(Date.now())}@example.com`;
      await prisma.user.create({
        data: { tenantId: TENANT_B_ID, email, name: 'B', role: 'ADMIN', passwordHash: await (await import('argon2')).hash('SecurePass123') },
      });
      const loginB = await http().post('/api/auth/login').send({ email, password: 'SecurePass123', tenant: 'wa-conn-b' }).expect(200);
      const headersB = { Authorization: `Bearer ${(loginB.body as { tokens: { accessToken: string } }).tokens.accessToken}` };
      await http().get(`/api/settings/messaging/accounts/${account.id}/logs`).set(headersB).expect(404);
      await prisma.user.deleteMany({ where: { email } });
    });

    it('невдала перевірка під час оновлення токена теж логується, без токена', async () => {
      const account = (await connect().expect(201)).body as AccountBody;
      stub.reset();
      stub.route('GET', 'debug_token', graphError(190, `bad app token ${APP_SECRET.slice(0, 20)}`, 400));
      await http().put(`/api/settings/messaging/accounts/${account.id}/credentials`).set(admin.headers).send({ accessToken: `${TOKEN.slice(0, -4)}ZZZZ` }).expect(400);

      const failed = await prisma.channelLog.findMany({ where: { accountId: account.id, ok: false } });
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ operation: 'verify', errorCode: 'app_secret_invalid' });
      expect(JSON.stringify(failed)).not.toContain(APP_SECRET.slice(0, 20));
    });
  });
});

describe('WhatsApp connection rate limit (e2e, CHAT-3a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let redis: Redis;
  let restore: () => void;
  let headers: { Authorization: string };
  let userId: string;
  const prefix = `${process.env.REALTIME_KEY_PREFIX ?? 'saas:rt:test'}:messaging-connect-limit`;

  beforeAll(async () => {
    const keys = { MESSAGING_CONNECT_LIMIT_PER_MINUTE: '2', REALTIME_KEY_PREFIX: prefix };
    const previous = Object.fromEntries(Object.keys(keys).map((k) => [k, process.env[k]]));
    Object.assign(process.env, keys);
    restore = (): void => {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    redis = new Redis(process.env.REDIS_URL ?? 'redis://:saas-realtime@localhost:6379');
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `wa-rl-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: 'wa-rl',
      role: 'ADMIN',
    });
    userId = user.id;
    headers = { Authorization: `Bearer ${tokens.accessToken}` };
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    const stale = await redis.keys(`${prefix}:*`);
    if (stale.length > 0) await redis.del(...stale);
    redis.disconnect();
    restore();
    await app.close();
  });

  it('понад ліміт: 429 із Retry-After; інші маршрути налаштувань не зачеплено (5.5)', async () => {
    const hit = () =>
      request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/settings/messaging/accounts/${randomUUID()}/sync`)
        .set(headers);
    const statuses = [(await hit()).status, (await hit()).status];
    const third = await hit();

    expect(statuses).toEqual([404, 404]);
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    await request(app.getHttpServer() as Parameters<typeof request>[0]).get('/api/settings/messaging').set(headers).expect(200);
  });
});
