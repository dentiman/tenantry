/// <reference types="jest" />
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { buildTestDatabaseUrl } from '../../api/test/test-database';

const OPERATOR_EMAIL = 'channel-events-operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';

/**
 * CHAT-2a: журнал вебхуків каналів без тенанта (chat/inbound «Deliveries that cannot be routed»).
 * Рядок пише tenant-плейн ТІЄЮ САМОЮ функцією, що й публічний вебхук (під saas_app) — тест
 * відтворює це напряму, а control plane лише читає.
 */
describe('Platform channel events (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let writer: Client;
  let token: string;
  const marker = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    writer = new Client({ connectionString: buildTestDatabaseUrl() });
    await writer.connect();

    await prisma.platformUser.deleteMany({ where: { email: OPERATOR_EMAIL } });
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'Channel Events Operator',
        passwordHash: await argon2.hash(OPERATOR_PASSWORD),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    token = String((login.body as { accessToken: string }).accessToken);
  });

  afterAll(async () => {
    await prisma.channelUnroutableEvent.deleteMany({ where: { keyHash: { startsWith: marker } } });
    await prisma.platformUser.deleteMany({ where: { email: OPERATOR_EMAIL } });
    await writer.end();
    await app.close();
  });

  const record = (suffix: string, reason: string): Promise<unknown> =>
    writer.query(`SELECT record_unroutable_event('fake', $1, $2, '203.0.113.9')`, [
      `${marker}-${suffix}`,
      reason,
    ]);

  const list = (query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get('/api/channel-events/unroutable')
      .query(query)
      .set('Authorization', `Bearer ${token}`);

  it('оператор бачить записане tenant-плейном: провайдер, хеш ключа, причину, ip — без тіла', async () => {
    await record('a', 'unknown_key');
    const res = await list({ limit: 200 }).expect(200);
    const body = res.body as { items: { keyHash: string; provider: string; reason: string; ip: string | null }[]; total: number };
    const mine = body.items.find((i) => i.keyHash === `${marker}-a`);
    expect(mine).toMatchObject({ provider: 'fake', reason: 'unknown_key', ip: '203.0.113.9' });
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Object.keys(mine ?? {}).sort()).toEqual(['id', 'ip', 'keyHash', 'provider', 'reason', 'receivedAt']);
  });

  it('фільтр за причиною й ліміт; найновіші першими', async () => {
    await record('b1', 'channel_disabled');
    await record('b2', 'channel_disabled');
    const res = await list({ reason: 'channel_disabled', limit: 1 }).expect(200);
    const body = res.body as { items: { keyHash: string; reason: string }[]; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.reason).toBe('channel_disabled');
    expect(body.items[0]?.keyHash).toBe(`${marker}-b2`);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('без токена оператора — 401', async () => {
    await request(app.getHttpServer()).get('/api/channel-events/unroutable').expect(401);
  });
});
