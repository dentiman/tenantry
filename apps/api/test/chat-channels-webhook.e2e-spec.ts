/// <reference types="jest" />

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Redis } from 'ioredis';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import {
  CryptoService,
  FAKE_SIGNATURE_HEADER,
  MessagePublisher,
  buildFakeWebhookBody,
  signFakeBody,
} from '@saas-skeleton/shared';
import type { NormalizedEvent } from '@saas-skeleton/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { sentJobs } from './__mocks__/pg-boss';
import { DEFAULT_TENANT_ID } from './test-users';

// CHAT-2a, публічний вебхук каналу (openspec/changes/chat-2a-channel-inbound, chat/inbound).
// Кожен тест — свій акаунт і свій ключ, тож стан одного не впливає на інший.

process.env.CHAT_DEV_TOOLS = 'true';

const INGEST_QUEUE = 'channels.ingest-webhook/channels-ingest';
const SECRET = 'e2e-fake-signing-secret';

function message(id: string): NormalizedEvent {
  return {
    kind: 'message',
    externalMessageId: id,
    channelExternalId: 'e2e-phone',
    from: { kind: 'phone', value: '380501234567' },
    profileName: 'Олена',
    sentAt: '2026-10-13T10:00:00.000Z',
    content: { type: 'text', body: `привіт ${id}` },
    providerMeta: {},
  };
}

describe('Channel webhook (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let crypto: CryptoService;
  const createdAccounts: string[] = [];
  const keyHashes: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    crypto = app.get(CryptoService);
  });

  // Один акаунт на (тенант, провайдер) — тож кожен тест прибирає свій перед наступним
  async function cleanup(): Promise<void> {
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId: { in: createdAccounts } } });
    await prisma.channel.deleteMany({ where: { accountId: { in: createdAccounts } } });
    await prisma.messagingAccount.deleteMany({ where: { id: { in: createdAccounts } } });
    createdAccounts.length = 0;
  }

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$executeRaw`DELETE FROM channel_unroutable_events WHERE key_hash = ANY(${keyHashes})`;
    await app.close();
  });

  beforeEach(() => {
    sentJobs.reset();
  });

  async function setup(
    overrides: { status?: 'CONNECTED' | 'DISABLED'; provider?: string } = {},
  ): Promise<{ key: string; accountId: string; url: string }> {
    const key = randomBytes(16).toString('hex');
    const account = await prisma.messagingAccount.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        provider: overrides.provider ?? 'fake',
        name: 'e2e',
        verifyToken: 'e2e-verify',
        webhookKey: key,
        appSecret: crypto.encrypt(SECRET),
        status: overrides.status ?? 'CONNECTED',
      },
    });
    createdAccounts.push(account.id);
    keyHashes.push(createHash('sha256').update(key).digest('hex'));
    return { key, accountId: account.id, url: `/api/public/channels/fake/${key}` };
  }

  const post = (url: string, body: Buffer | string, signature?: string) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return request(app.getHttpServer())
      .post(url)
      // Buffer із типом application/json superagent би серіалізував як `{"type":"Buffer",…}`:
      // потрібні саме ці байти, тому бінарний тип (сервер приймає будь-який)
      .set('Content-Type', 'application/octet-stream')
      .set(FAKE_SIGNATURE_HEADER, signature ?? signFakeBody(SECRET, buf))
      .send(buf);
  };

  const events = (accountId: string) =>
    prisma.channelWebhookEvent.findMany({ where: { accountId }, orderBy: { receivedAt: 'asc' } });
  const unroutable = (key: string) =>
    prisma.$queryRaw<{ reason: string; provider: string }[]>`
      SELECT reason, provider FROM channel_unroutable_events
       WHERE key_hash = ${createHash('sha256').update(key).digest('hex')}`;

  describe('handshake (GET)', () => {
    it('правильний verify token повертає challenge чистим текстом', async () => {
      const { url } = await setup();
      const res = await request(app.getHttpServer())
        .get(url)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'e2e-verify', 'hub.challenge': 'c-12345' });
      expect(res.status).toBe(200);
      expect(res.text).toBe('c-12345');
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('неправильний токен, невідомий ключ і невідомий провайдер — 403', async () => {
      const { url, key } = await setup();
      const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' };
      expect((await request(app.getHttpServer()).get(url).query(query)).status).toBe(403);
      expect(
        (await request(app.getHttpServer())
          .get('/api/public/channels/fake/no-such-key')
          .query({ ...query, 'hub.verify_token': 'e2e-verify' })).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer())
          .get(`/api/public/channels/nope/${key}`)
          .query({ ...query, 'hub.verify_token': 'e2e-verify' })).status,
      ).toBe(403);
    });
  });

  describe('підпис над сирими байтами (POST)', () => {
    it('валідний підпис: подію збережено рівно один раз, робота в черзі несе тенанта й лише id', async () => {
      const { url, accountId } = await setup();
      const body = buildFakeWebhookBody([message('m-1')]);

      const res = await post(url, body);
      expect(res.status).toBe(200);

      const rows = await events(accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'RECEIVED', body });

      const jobs = sentJobs.forQueue(INGEST_QUEUE);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.envelope).toMatchObject({
        name: 'channels.ingest-webhook',
        tenantId: DEFAULT_TENANT_ID,
        data: { eventId: rows[0]?.id },
      });
      // у черзі (поза RLS) — жодного тексту листування
      expect(JSON.stringify(jobs[0]?.envelope)).not.toContain('привіт');
    });

    it('сирі байти зберігаються точно: нетипові пробіли й не-ASCII не ламають підпис', async () => {
      const { url, accountId } = await setup();
      const body = `{ "events" :\n\t[ ${JSON.stringify(message('ünï-1'))}\n ] }`;
      expect((await post(url, body)).status).toBe(200);
      expect((await events(accountId))[0]?.body).toBe(body);
    });

    it('змінений байт → 401, нічого не збережено й не поставлено в чергу', async () => {
      const { url, accountId } = await setup();
      const body = Buffer.from(buildFakeWebhookBody([message('m-2')]));
      const signature = signFakeBody(SECRET, body);
      const altered = Buffer.from(body);
      const at = altered.length - 3;
      altered.writeUInt8(altered.readUInt8(at) ^ 0x01, at);

      const res = await post(url, altered, signature);
      expect(res.status).toBe(401);
      expect(await events(accountId)).toHaveLength(0);
      expect(sentJobs.forQueue(INGEST_QUEUE)).toHaveLength(0);
    });

    it('перевидане JSON з підписом оригіналу → 401', async () => {
      const { url, accountId } = await setup();
      const original = Buffer.from(buildFakeWebhookBody([message('m-3')]));
      const reserialised = JSON.stringify(JSON.parse(original.toString('utf8')), null, 2);
      expect((await post(url, reserialised, signFakeBody(SECRET, original))).status).toBe(401);
      expect(await events(accountId)).toHaveLength(0);
    });

    it('без підпису → 401', async () => {
      const { url } = await setup();
      const res = await request(app.getHttpServer())
        .post(url)
        .set('Content-Type', 'application/json')
        .send(buildFakeWebhookBody([message('m-4')]));
      expect(res.status).toBe(401);
    });

    it('дослівний повтор: один рядок і одна робота', async () => {
      const { url, accountId } = await setup();
      const body = buildFakeWebhookBody([message('m-5')]);
      expect((await post(url, body)).status).toBe(200);
      expect((await post(url, body)).status).toBe(200);
      expect(await events(accountId)).toHaveLength(1);
      expect(sentJobs.forQueue(INGEST_QUEUE)).toHaveLength(1);
    });

    it('підписане, але нерозбірне тіло: 200 і FAILED, без роботи в черзі', async () => {
      const { url, accountId } = await setup();
      const res = await post(url, 'this is not json');
      expect(res.status).toBe(200);
      const rows = await events(accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'FAILED', error: 'invalid_json' });
      expect(sentJobs.forQueue(INGEST_QUEUE)).toHaveLength(0);
    });

    it('збій транзакції: 5xx і нічого не збережено (провайдер повторить)', async () => {
      const { url, accountId } = await setup();
      const spy = jest
        .spyOn(app.get(MessagePublisher), 'publish')
        .mockRejectedValueOnce(new Error('queue down'));
      try {
        const res = await post(url, buildFakeWebhookBody([message('m-6')]));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await events(accountId)).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('що не маршрутизується: 200 і запис без тенанта', () => {
    it('невідомий ключ', async () => {
      const key = `unknown-${randomUUID()}`;
      keyHashes.push(createHash('sha256').update(key).digest('hex'));
      const res = await post(`/api/public/channels/fake/${key}`, buildFakeWebhookBody([message('u-1')]));
      expect(res.status).toBe(200);
      expect(await unroutable(key)).toEqual([{ reason: 'unknown_key', provider: 'fake' }]);
    });

    it('вимкнений акаунт — так само, як невідомий ключ', async () => {
      const { key, url, accountId } = await setup({ status: 'DISABLED' });
      const res = await post(url, buildFakeWebhookBody([message('u-2')]));
      expect(res.status).toBe(200);
      expect(await unroutable(key)).toHaveLength(1);
      expect(await events(accountId)).toHaveLength(0);
    });

    it('невідомий провайдер: 200, а не 404', async () => {
      const { key } = await setup();
      const res = await post(`/api/public/channels/nope/${key}`, buildFakeWebhookBody([message('u-3')]));
      expect(res.status).toBe(200);
    });

    it('запис про невідомий ключ не зберігає тіло й не містить сам ключ', async () => {
      const key = `unknown-${randomUUID()}`;
      keyHashes.push(createHash('sha256').update(key).digest('hex'));
      await post(`/api/public/channels/fake/${key}`, buildFakeWebhookBody([message('SECRET-TEXT')]));
      const dump = await prisma.$queryRaw<{ row: string }[]>`
        SELECT t::text AS row FROM channel_unroutable_events t
         WHERE key_hash = ${createHash('sha256').update(key).digest('hex')}`;
      expect(dump).toHaveLength(1);
      expect(dump[0]?.row).not.toContain('SECRET-TEXT');
      expect(dump[0]?.row).not.toContain(key);
    });
  });

  describe('тіло як Buffer лише на шляху каналів', () => {
    it('вебхук приймає тіло понад типовий ліміт 100 КБ (до 3 МБ)', async () => {
      const { url, accountId } = await setup();
      const big = buildFakeWebhookBody(
        Array.from({ length: 1500 }, (_, i) => message(`bulk-${String(i)}-${'x'.repeat(100)}`)),
      );
      expect(Buffer.byteLength(big)).toBeGreaterThan(200_000);
      expect((await post(url, big)).status).toBe(200);
      expect(await events(accountId)).toHaveLength(1);
    });

    it('решта API лишається з типовим лімітом', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(200_000) }));
      // body-parser відсікає тіло понад 100 КБ до обробника: 413, а AllExceptionsFilter ховає це в
      // 500 (наявна поведінка). Головне — запит не дійшов до логіну (там була б 400/401)
      expect([413, 500]).toContain(res.status);
    });
  });
});

describe('Channel webhook rate limit (e2e, CHAT-2a)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let redis: Redis;
  let restore: () => void;
  let accountId: string;
  let url: string;
  const prefix = `${process.env.REALTIME_KEY_PREFIX ?? 'saas:rt:test'}:channel-webhook-limit`;

  beforeAll(async () => {
    const keys = { CHANNEL_WEBHOOK_LIMIT_PER_MINUTE: '3', REALTIME_KEY_PREFIX: prefix };
    const previous = Object.fromEntries(Object.keys(keys).map((k) => [k, process.env[k]]));
    Object.assign(process.env, keys);
    restore = (): void => {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    redis = new Redis(process.env.REDIS_URL ?? 'redis://:saas-realtime@localhost:6379');

    const crypto = app.get(CryptoService);
    const key = randomBytes(16).toString('hex');
    const account = await prisma.messagingAccount.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        provider: 'fake',
        name: 'e2e-limit',
        verifyToken: 'v',
        webhookKey: key,
        appSecret: crypto.encrypt(SECRET),
      },
    });
    accountId = account.id;
    url = `/api/public/channels/fake/${key}`;
  });

  afterAll(async () => {
    await prisma.channelWebhookEvent.deleteMany({ where: { accountId } });
    await prisma.messagingAccount.delete({ where: { id: accountId } });
    const stale = await redis.keys(`${prefix}:*`);
    if (stale.length > 0) await redis.del(...stale);
    redis.disconnect();
    restore();
    await app.close();
  });

  it('понад ліміт: 429 із Retry-After, і те, що понад ліміт, не зберігається', async () => {
    const send = (n: number) => {
      const body = Buffer.from(buildFakeWebhookBody([message(`rl-${String(n)}`)]));
      return request(app.getHttpServer())
        .post(url)
        .set('X-Forwarded-For', '198.51.100.7')
        .set('Content-Type', 'application/octet-stream')
        .set(FAKE_SIGNATURE_HEADER, signFakeBody(SECRET, body))
        .send(body);
    };

    const statuses: number[] = [];
    let blocked: request.Response | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await send(i);
      statuses.push(res.status);
      if (res.status === 429) blocked = res;
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
    expect(blocked?.headers['retry-after']).toBeDefined();
    expect(await prisma.channelWebhookEvent.count({ where: { accountId } })).toBe(3);
  });
});
