/// <reference types="jest" />
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService, SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { PlatformAiSettingsReader } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';
import { sentJobs } from './__mocks__/pg-boss';

interface AiSettingsBody {
  enabled: boolean;
  availability: {
    installation: boolean;
    platform: boolean;
    tenantAllowed: boolean;
    tenantEnabled: boolean;
    available: boolean;
  };
}

/**
 * AI-5a: доступність асистента для tenant-а — інсталяція, вмикач платформи, дозвіл
 * tenant-у, вибір Tenant Admin (docs/ai-platform-controls.md §2.5).
 */
describe('AI assistant availability (e2e)', () => {
  let app: INestApplication;
  let system: SystemPrismaService;
  let reader: PlatformAiSettingsReader;
  let admin: { Authorization: string };
  let user: { Authorization: string };

  beforeAll(async () => {
    process.env.AI_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    system = app.get(SystemPrismaService);
    reader = app.get(PlatformAiSettingsReader);
  });

  beforeEach(async () => {
    await system.aiMessage.deleteMany();
    await system.aiConversation.deleteMany();
    await system.aiUsageCounter.deleteMany();
    await system.platformAiSettings.deleteMany();
    await system.tenantAiAccess.deleteMany();
    await system.authSession.deleteMany();
    await system.user.deleteMany();
    await system.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { settings: {} } });
    reader.invalidate();
    sentJobs.reset();
    const stamp = String(Date.now());
    const a = await createAndLoginTestUser(app, system, {
      email: `avail-admin-${stamp}@example.com`,
      password: 'SecurePass123',
      role: 'ADMIN',
    });
    const u = await createAndLoginTestUser(app, system, {
      email: `avail-user-${stamp}@example.com`,
      password: 'SecurePass123',
    });
    admin = { Authorization: `Bearer ${a.tokens.accessToken}` };
    user = { Authorization: `Bearer ${u.tokens.accessToken}` };
  });

  afterAll(async () => {
    await system.platformAiSettings.deleteMany();
    await system.tenantAiAccess.deleteMany();
    await system.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { settings: {} } });
    await app.close();
    delete process.env.AI_ENABLED;
  });

  const api = () => request(app.getHttpServer());
  const featureAi = async (headers: { Authorization: string }) =>
    (
      (await api().get('/api/settings/bootstrap').set(headers).expect(200)).body as {
        features: { ai: boolean };
      }
    ).features.ai;
  const ask = (headers: { Authorization: string }) =>
    api().post('/api/ai/conversation/messages').set(headers).send({ text: 'hello' });
  const aiSettings = async () =>
    (await api().get('/api/settings/ai').set(admin).expect(200)).body as AiSettingsBody;

  it('existing tenants keep the assistant: all levels default to on', async () => {
    expect(await featureAi(user)).toBe(true);
    await ask(user).expect(202);
    expect(await aiSettings()).toMatchObject({
      enabled: true,
      availability: {
        installation: true,
        platform: true,
        tenantAllowed: true,
        tenantEnabled: true,
        available: true,
      },
    });
  });

  it('the tenant admin switches the assistant off and on for the whole organization', async () => {
    const off = await api()
      .put('/api/settings/ai')
      .set(admin)
      .send({ enabled: false, persona: 'Ava', instructions: '' })
      .expect(200);
    expect((off.body as AiSettingsBody).availability).toMatchObject({
      tenantEnabled: false,
      available: false,
    });
    expect(await featureAi(user)).toBe(false);
    await ask(user).expect(403);
    await api().get('/api/ai/conversation').set(user).expect(403);

    await api()
      .put('/api/settings/ai')
      .set(admin)
      .send({ enabled: true, persona: 'Ava', instructions: '' })
      .expect(200);
    expect(await featureAi(user)).toBe(true);
  });

  it('the platform withdrawing the permission overrides the tenant admin', async () => {
    await system.tenantAiAccess.create({ data: { tenantId: DEFAULT_TENANT_ID, allowed: false } });
    expect(await featureAi(user)).toBe(false);
    await ask(user).expect(403);
    expect((await aiSettings()).availability).toMatchObject({
      tenantAllowed: false,
      tenantEnabled: true,
      available: false,
    });
  });

  it('the platform switch turns the assistant off for every tenant', async () => {
    await system.platformAiSettings.create({ data: { id: 'default', enabled: false } });
    reader.invalidate();
    expect(await featureAi(user)).toBe(false);
    await ask(user).expect(403);
    expect((await aiSettings()).availability).toMatchObject({ platform: false, available: false });
  });

  it('operator identity stays unreadable to tenant processes even after roles are re-applied', async () => {
    // global setup запускає db:roles ПІСЛЯ того, як міграції вже застосовані в тестовій БД —
    // саме сценарій, у якому широкий GRANT раніше скасовував REVOKE міграцій
    const tenantDb = app.get(PrismaService);
    await expect(tenantDb.$queryRaw`SELECT * FROM platform_users`).rejects.toThrow(
      /permission denied/,
    );
    await expect(tenantDb.$queryRaw`SELECT * FROM platform_auth_sessions`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('tenant processes cannot change platform settings or permissions, nor read the change log', async () => {
    const tenantDb = app.get(PrismaService);
    await expect(
      tenantDb.$executeRaw`UPDATE platform_ai_settings SET enabled = true`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenantDb.$executeRaw`INSERT INTO tenant_ai_access (tenant_id, allowed) VALUES (${DEFAULT_TENANT_ID}, true)`,
    ).rejects.toThrow(/permission denied/);
    await expect(tenantDb.$queryRaw`SELECT * FROM platform_ai_settings_events`).rejects.toThrow(
      /permission denied/,
    );
  });
});
