/// <reference types="jest" />
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const OPERATOR_EMAIL = 'ai-operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';
const API_KEY = 'sk-or-v1-e2e-secret-key-9876';

interface SettingsBody {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  apiKey: { configured: boolean; masked: string | null };
  effective: { model: string; sources: Record<string, string> };
  encryptionAvailable: boolean;
}

/**
 * AI-5a: налаштування асистента в control plane — ключ лише зашифрований, розкриття
 * пишеться в журнал, дозвіл tenant-у — окремий запис (docs/ai-platform-controls.md §2).
 */
describe('Platform AI settings (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let token: string;

  beforeAll(async () => {
    // Майстер-ключ і env-дефолти читаються при створенні сервісу — до compile()
    process.env.AI_SECRETS_KEY = randomBytes(32).toString('base64');
    process.env.AI_PROVIDER = 'fake';
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.platformAiSettingsEvent.deleteMany();
    await prisma.platformAiSettings.deleteMany();
    await prisma.tenantAiAccess.deleteMany();
    await prisma.platformUser.deleteMany();
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'AI Operator',
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
    await prisma.platformAiSettings.deleteMany();
    await prisma.tenantAiAccess.deleteMany();
    await app.close();
    delete process.env.AI_SECRETS_KEY;
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const put = (body: Record<string, unknown>) =>
    api()
      .put('/api/ai/settings')
      .set(auth())
      .send({ enabled: true, provider: null, baseUrl: null, model: null, ...body });

  it('without a row: environment defaults, nothing configured, encryption available', async () => {
    const res = await api().get('/api/ai/settings').set(auth()).expect(200);
    expect(res.body).toMatchObject({
      enabled: true,
      provider: null,
      apiKey: { configured: false, masked: null },
      effective: { provider: 'fake', sources: { provider: 'env', model: 'env', apiKey: 'env' } },
      encryptionAvailable: true,
    });
  });

  it('stores the key encrypted, returns only a mask, and logs the change without the key', async () => {
    const res = await put({
      provider: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.6-luna',
      apiKey: API_KEY,
    }).expect(200);
    const body = res.body as SettingsBody;
    expect(body.apiKey).toEqual({ configured: true, masked: '••••9876' });
    expect(body.effective).toMatchObject({
      model: 'openai/gpt-5.6-luna',
      sources: { model: 'platform', apiKey: 'platform' },
    });
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);

    const row = await prisma.platformAiSettings.findUniqueOrThrow({ where: { id: 'default' } });
    expect(row.apiKeyEncrypted?.startsWith('v1:')).toBe(true);
    expect(row.apiKeyEncrypted).not.toContain(API_KEY);
    expect(row.updatedBy).toBe(OPERATOR_EMAIL);

    const events = await api().get('/api/ai/settings/events').set(auth()).expect(200);
    expect(JSON.stringify(events.body)).not.toContain(API_KEY);
    expect(
      (events.body as { items: { type: string; changes: Record<string, unknown> }[] }).items[0],
    ).toMatchObject({
      type: 'updated',
      changes: { apiKey: 'set', model: { from: null, to: 'openai/gpt-5.6-luna' } },
    });
  });

  it('reveals the key only on the explicit action and records who did it', async () => {
    await put({
      provider: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'm',
      apiKey: API_KEY,
    }).expect(200);
    const revealed = await api().post('/api/ai/settings/api-key/reveal').set(auth()).expect(200);
    expect(revealed.body).toEqual({ apiKey: API_KEY });
    const events = await prisma.platformAiSettingsEvent.findMany({
      where: { type: 'key_revealed' },
    });
    expect(events).toEqual([expect.objectContaining({ actorLabel: OPERATOR_EMAIL })]);
  });

  it('omitting the key keeps it; null removes it; reveal without a key is 404', async () => {
    await put({
      provider: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'm',
      apiKey: API_KEY,
    }).expect(200);
    const kept = await put({
      provider: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'other',
    }).expect(200);
    expect((kept.body as SettingsBody).apiKey.configured).toBe(true);
    const cleared = await put({ provider: 'fake', apiKey: null }).expect(200);
    expect((cleared.body as SettingsBody).apiKey).toEqual({ configured: false, masked: null });
    await api().post('/api/ai/settings/api-key/reveal').set(auth()).expect(404);
  });

  it('refuses a real provider without URL, model or key anywhere — on the field', async () => {
    const res = await put({ provider: 'openai-compat' }).expect(400);
    const fields = (res.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors
      .map((e) => e.field)
      .sort();
    expect(fields).toEqual(['apiKey', 'baseUrl', 'model']);
  });

  it('rejects an insecure or credential-carrying base URL', async () => {
    await put({ baseUrl: 'http://example.com/v1' }).expect(400);
    await put({ baseUrl: 'https://user:pass@example.com/v1' }).expect(400);
    await put({ baseUrl: 'http://localhost:4010/v1' }).expect(200);
  });

  it('requires an operator token', async () => {
    await api().get('/api/ai/settings').expect(401);
    await api().post('/api/ai/settings/api-key/reveal').expect(401);
  });

  it('a tenant is allowed by default; the operator can withdraw and restore the permission', async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'default' } });
    const before = await api().get(`/api/tenants/${tenant.id}`).set(auth()).expect(200);
    expect((before.body as { aiAllowed: boolean }).aiAllowed).toBe(true);

    const off = await api()
      .patch(`/api/tenants/${tenant.id}`)
      .set(auth())
      .send({ aiAllowed: false })
      .expect(200);
    expect((off.body as { aiAllowed: boolean }).aiAllowed).toBe(false);
    expect(
      await prisma.tenantAiAccess.findUnique({ where: { tenantId: tenant.id } }),
    ).toMatchObject({ allowed: false });

    const on = await api()
      .patch(`/api/tenants/${tenant.id}`)
      .set(auth())
      .send({ aiAllowed: true })
      .expect(200);
    expect((on.body as { aiAllowed: boolean }).aiAllowed).toBe(true);
  });
});
