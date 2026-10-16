/// <reference types="jest" />

import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaModule, SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  ChannelAdapterRegistry,
  ChannelIngestService,
  ChannelStatusService,
  ConversationWorkflow,
  CryptoService,
  MetaCloudAdapter,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { sentJobs } from './__mocks__/pg-boss';
import { DEFAULT_TENANT_ID } from './test-users';

// CHAT-3b1: захоплення вебхуків Meta. Публічна адреса справжня, БД справжня; нічого не інтерпретується.

const APP_SECRET = 'e2e-app-secret-0123456789';
const VERIFY_TOKEN = 'e2e-verify-token';
// Форма статусу з експорту fms-dev: біз-опак-дата вертається, є pricing і BSUID
const STATUS_BODY =
  '{"object":"whatsapp_business_account","entry":[{"id":"210000000000001","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550000001","phone_number_id":"120000000000001"},"contacts":[{"wa_id":"380000000000","user_id":"UA.1"}],"statuses":[{"id":"wamid.AAA","status":"delivered","timestamp":"1791961399","recipient_id":"380000000000","biz_opaque_callback_data":"11111111-1111-4111-8111-111111111111","pricing":{"billable":true,"category":"utility"}}]},"field":"messages"}]}]}';

describe('Meta webhook capture (e2e, CHAT-3b1)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantContext: TenantContextService;
  let transactions: TenantTransactions;
  let ingest: ChannelIngestService;
  let accountId: string;
  let key: string;

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const path = (k = key) => `/api/public/channels/meta_cloud/${k}`;
  const sign = (body: string, secret = APP_SECRET): string =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const post = (body: string, signature?: string, k = key) => {
    const req = http().post(path(k)).set('Content-Type', 'application/json');
    if (signature) req.set('X-Hub-Signature-256', signature);
    return req.set('Cookie', 'session=secret-cookie').send(body);
  };
  const events = () => prisma.channelWebhookEvent.findMany({ where: { accountId }, orderBy: { receivedAt: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
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
  });

  beforeEach(async () => {
    sentJobs.reset();
    delete process.env.CHANNEL_WEBHOOK_SIGNATURE;
    key = randomBytes(16).toString('hex');
    accountId = (
      await prisma.messagingAccount.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          provider: 'meta_cloud',
          name: 'capture e2e',
          verifyToken: VERIFY_TOKEN,
          webhookKey: key,
          appSecret: app.get(CryptoService).encrypt(APP_SECRET),
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.deleteMany({ where: { id: accountId } });
    delete process.env.CHANNEL_WEBHOOK_SIGNATURE;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('рукостискання', () => {
    const query = (over: Record<string, string> = {}) => ({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1235484575',
      ...over,
    });

    it('правильний токен: challenge текстом', async () => {
      const res = await http().get(path()).query(query()).expect(200);
      expect(res.text).toBe('1235484575');
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('чужий токен, невідомий ключ, не той режим — 403 і нічого не збережено', async () => {
      await http().get(path()).query(query({ 'hub.verify_token': 'nope' })).expect(403);
      await http().get(path('0'.repeat(32))).query(query()).expect(403);
      await http().get(path()).query(query({ 'hub.mode': 'unsubscribe' })).expect(403);
      expect(await events()).toHaveLength(0);
    });
  });

  describe('POST', () => {
    it('зберігає байти як є, заголовки без cookie, результат підпису; ingest статусу без каналу — нероутоване, розмов не чіпає', async () => {
      const conversations = await prisma.conversation.count();
      const messages = await prisma.chatMessage.count();

      await post(STATUS_BODY, sign(STATUS_BODY)).expect(200);

      const [stored] = await events();
      expect(stored?.body).toBe(STATUS_BODY);
      expect(stored?.signatureValid).toBe(true);
      expect(stored?.state).toBe('RECEIVED');
      const headers = stored?.headers as Record<string, string>;
      expect(headers['x-hub-signature-256']).toBe(sign(STATUS_BODY));
      expect(headers['content-type']).toContain('application/json');
      expect(headers.cookie).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('secret-cookie');

      const eventId = stored?.id ?? '';
      const outcome = await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        transactions.withTenantTx((tx) => ingest.ingestEvent(tx, eventId)),
      );
      // Канал із phone_number_id тіла в цього акаунта не заведено: подія нероутована (3b2), а не мовчки «оброблена»
      expect(outcome.state).toBe('UNROUTABLE');
      expect(outcome.stored).toBe(0);
      expect(await prisma.conversation.count()).toBe(conversations);
      expect(await prisma.chatMessage.count()).toBe(messages);
    });

    it('дослівний повтор — один рядок і одна робота в черзі', async () => {
      await post(STATUS_BODY, sign(STATUS_BODY)).expect(200);
      await post(STATUS_BODY, sign(STATUS_BODY)).expect(200);
      expect(await events()).toHaveLength(1);
      expect(sentJobs.forQueue('channels.ingest-webhook/channels-ingest')).toHaveLength(1);
    });

    it('не-JSON з дійсним підписом: FAILED, 200, помилка invalid_json', async () => {
      await post('<<not json>>', sign('<<not json>>')).expect(200);
      const [stored] = await events();
      expect(stored).toMatchObject({ state: 'FAILED', error: 'invalid_json', signatureValid: true });
    });

    it('невідомий ключ — 200 без запису події (нероутоване)', async () => {
      await post(STATUS_BODY, sign(STATUS_BODY), '0'.repeat(32)).expect(200);
      expect(await events()).toHaveLength(0);
    });
  });

  describe('політика підпису', () => {
    it('enforce (типово): неправильний, чужий секрет і відсутній підпис — 401 і нічого не збережено', async () => {
      await post(STATUS_BODY, sign(STATUS_BODY, 'wrong')).expect(401);
      await post(STATUS_BODY, `sha256=${'0'.repeat(64)}`).expect(401);
      await post(STATUS_BODY).expect(401);
      expect(await events()).toHaveLength(0);
    });

    it('record: приймається і зберігається з результатом false / false', async () => {
      process.env.CHANNEL_WEBHOOK_SIGNATURE = 'record';
      await post(STATUS_BODY, sign(STATUS_BODY, 'wrong')).expect(200);
      await post(`${STATUS_BODY} `).expect(200);
      const rows = await events();
      expect(rows.map((r) => r.signatureValid)).toEqual([false, false]);
    });

    it('record без app secret: signature_valid = null; enforce такий запит відхиляє', async () => {
      await prisma.messagingAccount.update({ where: { id: accountId }, data: { appSecret: null } });
      await post(STATUS_BODY, sign(STATUS_BODY)).expect(401);
      process.env.CHANNEL_WEBHOOK_SIGNATURE = 'record';
      await post(STATUS_BODY, sign(STATUS_BODY)).expect(200);
      expect((await events())[0]?.signatureValid).toBeNull();
    });
  });
});
