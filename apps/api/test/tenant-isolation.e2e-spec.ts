/// <reference types="jest" />

// MT-2: ізоляція тенантів наскрізно (docs/multi-tenancy-plan.md §12).
// Другий tenant створюється System-клієнтом (у проді це робитиме platform-api, MT-3);
// увесь доступ tenant-а A йде через HTTP — як у реального юзера.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService, SystemPrismaService, TenantContextService } from '@saas-skeleton/database';
import {
  createAndLoginTestUser,
  createTestUser,
  refreshTokenFromCookie,
  DEFAULT_TENANT_ID,
} from './test-users';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000002';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let sysPrisma: SystemPrismaService;
  let tenantPrisma: PrismaService;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    sysPrisma = app.get(SystemPrismaService);
    tenantPrisma = app.get(PrismaService);
    tenantContext = app.get(TenantContextService);

    await sysPrisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'tenant-b', name: 'Tenant B' },
    });
  });

  beforeEach(async () => {
    await sysPrisma.authSession.deleteMany();
    await sysPrisma.user.deleteMany();
  });

  afterAll(async () => {
    await sysPrisma.user.deleteMany();
    await sysPrisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  /** Юзер у tenant B — створюється оператором (BYPASSRLS), логін через API неможливий до MT-3 */
  const createUserInTenantB = async (suffix: string) =>
    sysPrisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: `b-user-${suffix}@example.com`,
        name: 'B User',
        role: 'USER',
      },
    });

  it('list юзерів tenant-а A НЕ містить юзерів tenant-а B', async () => {
    const suffix = String(Date.now());
    await createUserInTenantB(suffix);
    const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
      email: `a-admin-${suffix}@example.com`,
      password: 'AdminPass123',
      role: 'ADMIN',
    });

    const response = await request(app.getHttpServer())
      .get('/api/users?page=1&limit=100')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);

    const emails = (response.body.items as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(`a-admin-${suffix}@example.com`);
    expect(emails).not.toContain(`b-user-${suffix}@example.com`);
    expect(response.body.total).toBe(1);
  });

  it('get/update/delete чужої сутності по ID → 404 (не 403 — існування не палиться)', async () => {
    const suffix = String(Date.now());
    const userB = await createUserInTenantB(suffix);
    const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
      email: `a-admin2-${suffix}@example.com`,
      password: 'AdminPass123',
      role: 'ADMIN',
    });
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };

    await request(app.getHttpServer()).get(`/api/users/${userB.id}`).set(auth).expect(404);
    await request(app.getHttpServer())
      .patch(`/api/users/${userB.id}`)
      .set(auth)
      .send({ name: 'Hacked' })
      .expect(404);
    await request(app.getHttpServer()).delete(`/api/users/${userB.id}`).set(auth).expect(404);

    // Рядок B неушкоджений (перевірка оператором)
    const untouched = await sysPrisma.user.findUnique({ where: { id: userB.id } });
    expect(untouched?.name).toBe('B User');
  });

  it('JWT tenant-а B при АВТОРИТЕТНІЙ резолюції в A (явний slug) → 401 від guard-звірки', async () => {
    const suffix = String(Date.now());
    const userB = await createUserInTenantB(suffix);

    // Токен формально валідний (наш secret), tenantId=B; але запит НЕСЕ slug 'default' —
    // slug-резолюція авторитетна → mismatch → 401. Без slug-а авторитет належить токену
    // (див. TenantResolution у tenant-resolver.ts) — це семантика MT-3; піддомени (MT-4)
    // зроблять резолюцію авторитетною на КОЖНОМУ запиті.
    const jwtService = app.get(JwtService);
    const foreignToken = await jwtService.signAsync({
      sub: userB.id,
      email: userB.email,
      role: userB.role,
      tenantId: TENANT_B_ID,
      // AUTH-1: токен без sid відхиляється як «виданий до переходу на сесії»,
      // і тест перевіряв би не ту межу — тут предмет саме звірка тенантів
      sid: '33333333-3333-4333-8333-333333333333',
      jti: '44444444-4444-4444-8444-444444444444',
    });

    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({
        tenant: 'default',
        email: 'x@x.com',
        name: 'X',
        role: 'USER',
        password: 'Xx12345678',
      })
      .expect(401);

    // Без slug-а токен B легальний — але бачить ЛИШЕ tenant B (RLS)
    const list = await request(app.getHttpServer())
      .get('/api/users?page=1&limit=100')
      .set('Authorization', `Bearer ${foreignToken}`)
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('CLS-конкурентність: паралельні контексти різних тенантів не перетікають', async () => {
    // Прямий тест механіки CLS→extension→RLS (HTTP-конкурентність двох тенантів
    // неможлива до slug-логіну MT-3: StaticTenantResolver завжди дає default).
    const suffix = String(Date.now());
    await createUserInTenantB(suffix);
    await createTestUser(sysPrisma, { email: `a-1-${suffix}@example.com` });
    await createTestUser(sysPrisma, { email: `a-2-${suffix}@example.com` });

    const countIn = (tenantId: string): Promise<number> =>
      tenantContext.runWith(tenantId, async () => {
        // штучне чергування event loop — якби контекст протікав, лічильники б змішались
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        return tenantPrisma.user.count();
      });

    const results = await Promise.all([
      countIn(DEFAULT_TENANT_ID),
      countIn(TENANT_B_ID),
      countIn(DEFAULT_TENANT_ID),
      countIn(TENANT_B_ID),
      countIn(DEFAULT_TENANT_ID),
      countIn(TENANT_B_ID),
    ]);

    expect(results).toEqual([2, 1, 2, 1, 2, 1]);
  });

  it('MT-3 slug-login: юзер tenant-а B логіниться зі slug-ом і бачить СВІЙ tenant', async () => {
    const suffix = String(Date.now());
    await createUserInTenantB(suffix);
    const passwordHash = await (await import('argon2')).hash('BUserPass123');
    const userB = await sysPrisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: `b-slug-${suffix}@example.com`,
        passwordHash,
        role: 'ADMIN',
      },
    });
    await createTestUser(sysPrisma, { email: `a-noise-${suffix}@example.com` });

    // slug у payload → resolve_tenant → контекст B → login у B
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: userB.email, password: 'BUserPass123', tenant: 'tenant-b' })
      .expect(200);
    const payload = JSON.parse(
      Buffer.from(String(login.body.tokens.accessToken).split('.')[1] ?? '', 'base64').toString(),
    ) as { tenantId: string };
    expect(payload.tenantId).toBe(TENANT_B_ID);
    // refresh-токен (тепер у cookie, AUTH-2) несе префікс tenant-а B
    expect(refreshTokenFromCookie(login).startsWith(`${TENANT_B_ID}:`)).toBe(true);

    // і бачить ЛИШЕ юзерів свого tenant-а
    const list = await request(app.getHttpServer())
      .get('/api/users?page=1&limit=100')
      .set('Authorization', `Bearer ${String(login.body.tokens.accessToken)}`)
      .expect(200);
    const emails = (list.body.items as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(userB.email);
    expect(emails).not.toContain(`a-noise-${suffix}@example.com`);
  });

  it('MT-3 slug-login: невідомий slug → той самий 401 (без оракула існування)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'whoever@example.com', password: 'whatever123', tenant: 'no-such-tenant' })
      .expect(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  it('login юзера tenant-а B через API неможливий у контексті A (той самий 401)', async () => {
    const suffix = String(Date.now());
    // Юзер B з паролем — але login шукає у резолвленому (default) tenant-і
    await sysPrisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: `b-login-${suffix}@example.com`,
        passwordHash:
          // argon2-хеш не потрібен валідний: до перевірки пароля не дійде (юзера не видно)
          '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `b-login-${suffix}@example.com`, password: 'whatever123' })
      .expect(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  // ---- AUTH-1: сесії-пристрої під тією самою ізоляцією, що решта tenant-таблиць ----

  it('сесія юзера tenant-а B не видима під контекстом A', async () => {
    const suffix = String(Date.now());
    const userB = await createUserInTenantB(`sess-${suffix}`);
    await sysPrisma.authSession.create({
      data: {
        tenantId: TENANT_B_ID,
        userId: userB.id,
        tokenHash: 'sha256:deadbeef',
        idleExpiresAt: new Date(Date.now() + 3600_000),
        absoluteExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    // Той самий прийом, що для решти таблиць: читаємо tenant-клієнтом у контексті A
    const visible = await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantPrisma.authSession.findMany({ where: { userId: userB.id } }),
    );
    expect(visible).toEqual([]);
  });

  it('DELETE чужої сесії з tenant-а B у контексті A → 404, рядок живий', async () => {
    const suffix = String(Date.now());
    const userB = await createUserInTenantB(`del-${suffix}`);
    const sessionB = await sysPrisma.authSession.create({
      data: {
        tenantId: TENANT_B_ID,
        userId: userB.id,
        tokenHash: 'sha256:deadbeef',
        idleExpiresAt: new Date(Date.now() + 3600_000),
        absoluteExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
      email: `a-owner-${suffix}@example.com`,
      password: 'AdminPass12345',
    });

    await request(app.getHttpServer())
      .delete(`/api/account/sessions/${sessionB.id}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(404);

    const stillThere = await sysPrisma.authSession.findUnique({ where: { id: sessionB.id } });
    expect(stillThere?.revokedAt).toBeNull();
  });
});
