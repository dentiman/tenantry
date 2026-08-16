/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  const createUserPayload = (
    suffix: string,
  ): { email: string; name: string; role: 'ADMIN' | 'USER'; password: string } => ({
    email: `user-${suffix}@example.com`,
    name: `User ${suffix}`,
    role: 'USER',
    password: 'InitialPass123',
  });

  // Для прямого prisma.user.create — без password (у БД зберігається тільки хеш)
  const createDbUserData = (
    suffix: string,
  ): { email: string; name: string; role: 'ADMIN' | 'USER' } => {
    const { password: _password, ...data } = createUserPayload(suffix);
    return data;
  };

  const createAuthUserPayload = (
    suffix: string,
  ): { email: string; password: string; name: string } => ({
    email: `auth-${suffix}@example.com`,
    password: 'SecurePass123',
    name: `Auth ${suffix}`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);

    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const createAuthHeaders = async (suffix: string): Promise<{ Authorization: string }> => {
    // MT-1: register видалено — юзер створюється напряму і логіниться
    const payload = createAuthUserPayload(suffix);
    const { tokens } = await createAndLoginTestUser(app, prisma, payload);
    return {
      Authorization: `Bearer ${tokens.accessToken}`,
    };
  };

  it('creates a user', async () => {
    const payload = createUserPayload(`${Date.now()}-create`);
    const headers = await createAuthHeaders(`${Date.now()}-create-admin`);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(payload)
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        email: payload.email,
        name: payload.name,
        role: payload.role,
        isActive: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
  });

  it('stores the phone in E.164 and derives the country when it is not sent', async () => {
    const payload = createUserPayload(`${Date.now()}-phone`);
    const headers = await createAuthHeaders(`${Date.now()}-phone-admin`);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({ ...payload, phone: '+380671234567' })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({ phone: '+380671234567', phoneCountry: 'UA' }),
    );
  });

  it('keeps the country sent by the client (+1 is ambiguous between US and CA)', async () => {
    const payload = createUserPayload(`${Date.now()}-phone-ca`);
    const headers = await createAuthHeaders(`${Date.now()}-phone-ca-admin`);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      // Той самий номер libphonenumber сам віддав би як US — тут перевіряється,
      // що явний вибір користувача не перезаписується здогадкою
      .send({ ...payload, phone: '+14165550123', phoneCountry: 'CA' })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({ phone: '+14165550123', phoneCountry: 'CA' }),
    );
  });

  it('rejects a phone number that is not valid for its country', async () => {
    const payload = createUserPayload(`${Date.now()}-phone-bad`);
    const headers = await createAuthHeaders(`${Date.now()}-phone-bad-admin`);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      // Правильний код країни, але закоротка національна частина
      .send({ ...payload, phone: '+38067123' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        fieldErrors: expect.arrayContaining([expect.objectContaining({ field: 'phone' })]),
      }),
    );
  });

  it('clears the country together with the phone', async () => {
    const payload = createUserPayload(`${Date.now()}-phone-clear`);
    const headers = await createAuthHeaders(`${Date.now()}-phone-clear-admin`);

    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({ ...payload, phone: '+380671234567' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/api/users/${created.body.id as string}`)
      .set(headers)
      .send({ phone: null })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ phone: null, phoneCountry: null }),
    );
  });

  it('rejects create without password', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-no-password-admin`);
    const { password: _password, ...withoutPassword } = createUserPayload(
      `${Date.now()}-no-password`,
    );

    await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(withoutPassword)
      .expect(400);
  });

  it('created user can login with the initial password', async () => {
    const payload = createUserPayload(`${Date.now()}-login`);
    const headers = await createAuthHeaders(`${Date.now()}-login-admin`);

    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(payload)
      .expect(201);

    // Пароль (і його хеш) не витікають у відповідь
    expect(created.body).not.toHaveProperty('password');
    expect(created.body).not.toHaveProperty('passwordHash');

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);

    expect(login.body.tokens.accessToken).toMatch(/^eyJ/);
  });

  it('lists users with pagination and filtering', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-list-admin`);
    const admin = await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `admin-${Date.now()}@example.com`,
        name: 'Alice Admin',
        role: 'ADMIN',
      },
    });

    await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `user-${Date.now()}@example.com`,
        name: 'Bob User',
        role: 'USER',
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ role: 'ADMIN', search: 'alice', page: 1, limit: 10 })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(10);
    expect(response.body.totalPages).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        id: admin.id,
        email: admin.email,
        role: 'ADMIN',
      }),
    );
  });

  it('searches users by partial email and partial name (case-insensitive)', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-search-admin`);
    const target = await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: 'carol.finder@example.com',
        name: 'Carol Finder',
        role: 'USER',
      },
    });
    await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `other-${Date.now()}@example.com`,
        name: 'Dave Other',
        role: 'USER',
      },
    });

    // Частковий фрагмент email, інший регістр
    const byEmail = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ search: 'CAROL.FIND', page: 1, limit: 10 })
      .expect(200);
    expect(byEmail.body.total).toBe(1);
    expect(byEmail.body.items[0].id).toBe(target.id);

    // Частковий фрагмент імені
    const byName = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ search: 'finde', page: 1, limit: 10 })
      .expect(200);
    expect(byName.body.total).toBe(1);
    expect(byName.body.items[0].id).toBe(target.id);
  });

  it('gets user by id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-get-admin`);
    const user = await prisma.user.create({
      data: { tenantId: DEFAULT_TENANT_ID, ...createDbUserData(`${Date.now()}-get`) },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/users/${user.id}`)
      .set(headers)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      }),
    );
  });

  it('updates a user', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-update-admin`);
    const user = await prisma.user.create({
      data: { tenantId: DEFAULT_TENANT_ID, ...createDbUserData(`${Date.now()}-update`) },
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/users/${user.id}`)
      .set(headers)
      .send({ name: 'Updated Name', role: 'ADMIN' })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: user.id,
        name: 'Updated Name',
        role: 'ADMIN',
      }),
    );
  });

  it('deletes a user', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-delete-admin`);
    const user = await prisma.user.create({
      data: { tenantId: DEFAULT_TENANT_ID, ...createDbUserData(`${Date.now()}-delete`) },
    });

    await request(app.getHttpServer()).delete(`/api/users/${user.id}`).set(headers).expect(204);

    await request(app.getHttpServer()).get(`/api/users/${user.id}`).set(headers).expect(404);
  });

  it('returns 400 for invalid create payload', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid-create-admin`);
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({ email: 'not-an-email', role: 'OWNER' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      }),
    );
    const fieldErrors = response.body.fieldErrors as { field: string; message: string }[];
    expect(Array.isArray(fieldErrors)).toBe(true);
    expect(fieldErrors.map((fe) => fe.field)).toEqual(expect.arrayContaining(['email', 'role']));
  });

  it('returns 409 for duplicate email', async () => {
    const payload = createUserPayload(`${Date.now()}-duplicate`);
    const headers = await createAuthHeaders(`${Date.now()}-duplicate-admin`);

    await request(app.getHttpServer()).post('/api/users').set(headers).send(payload).expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(payload)
      .expect(409);

    // Явна перевірка в UsersService.create → 409 із fieldErrors по полю email —
    // фронт покаже помилку прямо під полем форми
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Email already registered',
        fieldErrors: [
          { field: 'email', message: 'Email already registered', code: 'already_exists' },
        ],
      }),
    );
  });

  it('returns 404 for get by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-get-admin`);
    const response = await request(app.getHttpServer())
      .get('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
  });

  it('returns 404 for update by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-update-admin`);
    const response = await request(app.getHttpServer())
      .patch('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .send({ name: 'Nobody' })
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
    expect(response.body.message).toBe('Resource not found');
  });

  it('returns 404 for delete by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-delete-admin`);
    const response = await request(app.getHttpServer())
      .delete('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
    expect(response.body.message).toBe('Resource not found');
  });

  it('sorts users by email ascending and descending, with a stable tie-breaker', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-sort-admin`);
    const suffix = Date.now();
    // Різні email, той самий name (перевіряє tie-breaker по id, коли sortBy не унікальний)
    await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `charlie-${suffix}@example.com`,
        name: 'Same Name',
        role: 'USER',
      },
    });
    await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `alpha-${suffix}@example.com`,
        name: 'Same Name',
        role: 'USER',
      },
    });
    await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: `bravo-${suffix}@example.com`,
        name: 'Same Name',
        role: 'USER',
      },
    });

    const asc = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ search: String(suffix), sortBy: 'email', sortOrder: 'asc', page: 1, limit: 10 })
      .expect(200);
    expect(asc.body.items.map((u: { email: string }) => u.email)).toEqual([
      `alpha-${suffix}@example.com`,
      `bravo-${suffix}@example.com`,
      `charlie-${suffix}@example.com`,
    ]);

    const desc = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ search: String(suffix), sortBy: 'email', sortOrder: 'desc', page: 1, limit: 10 })
      .expect(200);
    expect(desc.body.items.map((u: { email: string }) => u.email)).toEqual([
      `charlie-${suffix}@example.com`,
      `bravo-${suffix}@example.com`,
      `alpha-${suffix}@example.com`,
    ]);
  });

  it('returns 400 for an unknown sortBy value', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid-sort-admin`);
    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ sortBy: 'passwordHash' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }),
    );
  });

  it('returns 400 for invalid list query params', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid-list-admin`);
    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ page: 0, limit: 201, isActive: 'not-boolean' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(Array.isArray(response.body.fieldErrors)).toBe(true);
  });

  describe('password change', () => {
    it('replaces the password, revokes every refresh session and records the activity', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-pwd-admin`);
      const target = await createAndLoginTestUser(app, prisma, {
        email: `pwd-target-${String(Date.now())}@example.com`,
        password: 'OldPass12345',
      });

      // Логін вище видав рефреш — саме його зміна пароля мусить відкликати
      expect(await prisma.refreshToken.count({ where: { userId: target.user.id } })).toBe(1);

      await request(app.getHttpServer())
        .post(`/api/users/${target.user.id}/password`)
        .set(headers)
        .send({ password: 'BrandNewPass123' })
        .expect(204);

      expect(await prisma.refreshToken.count({ where: { userId: target.user.id } })).toBe(0);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target.user.email, password: 'OldPass12345' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target.user.email, password: 'BrandNewPass123' })
        .expect(200);

      const feed = await request(app.getHttpServer())
        .get('/api/activities')
        .set(headers)
        .query({ entityType: 'user', entityId: target.user.id, type: 'user.password_changed' })
        .expect(200);

      expect(feed.body.items).toHaveLength(1);
      // Актор — адмін, що натиснув, а не цільовий юзер
      expect(feed.body.items[0]).toEqual(
        expect.objectContaining({ type: 'user.password_changed', actorType: 'user' }),
      );
      // Журнал не має знати ні пароля, ні його хеша
      expect(JSON.stringify(feed.body.items[0].payload)).not.toContain('BrandNewPass123');
    });

    it('returns 400 for a password shorter than the contract allows', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-pwd-short-admin`);
      const user = await prisma.user.create({
        data: { tenantId: DEFAULT_TENANT_ID, ...createDbUserData(`${Date.now()}-pwd-short`) },
      });

      const response = await request(app.getHttpServer())
        .post(`/api/users/${user.id}/password`)
        .set(headers)
        .send({ password: 'short' })
        .expect(400);

      expect(response.body).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('returns 404 for password change on a non-existing user', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-pwd-404-admin`);
      await request(app.getHttpServer())
        .post('/api/users/00000000-0000-4000-8000-000000000999/password')
        .set(headers)
        .send({ password: 'BrandNewPass123' })
        .expect(404);
    });
  });

  describe('enable / disable', () => {
    it('disables a user, kills the sessions and blocks the next login', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-disable-admin`);
      const target = await createAndLoginTestUser(app, prisma, {
        email: `disable-target-${String(Date.now())}@example.com`,
        password: 'TargetPass123',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/users/${target.user.id}/status`)
        .set(headers)
        .send({ isActive: false })
        .expect(200);

      expect(response.body).toEqual(expect.objectContaining({ id: target.user.id, isActive: false }));
      expect(await prisma.refreshToken.count({ where: { userId: target.user.id } })).toBe(0);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target.user.email, password: 'TargetPass123' })
        .expect(401);

      const feed = await request(app.getHttpServer())
        .get('/api/activities')
        .set(headers)
        .query({ entityType: 'user', entityId: target.user.id, type: 'user.disabled' })
        .expect(200);
      expect(feed.body.items).toHaveLength(1);
    });

    it('enables a user back and records a separate activity type', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-enable-admin`);
      const user = await createTestUser(prisma, {
        email: `enable-target-${String(Date.now())}@example.com`,
        password: 'TargetPass123',
        isActive: false,
      });

      await request(app.getHttpServer())
        .patch(`/api/users/${user.id}/status`)
        .set(headers)
        .send({ isActive: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'TargetPass123' })
        .expect(200);

      const feed = await request(app.getHttpServer())
        .get('/api/activities')
        .set(headers)
        .query({ entityType: 'user', entityId: user.id, type: 'user.enabled' })
        .expect(200);
      expect(feed.body.items).toHaveLength(1);
    });

    it('does not record an activity when the status is already the requested one', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-noop-admin`);
      const user = await prisma.user.create({
        data: { tenantId: DEFAULT_TENANT_ID, ...createDbUserData(`${Date.now()}-noop`) },
      });

      // Юзер уже активний — повторне вмикання мусить бути no-op БЕЗ запису у фід
      await request(app.getHttpServer())
        .patch(`/api/users/${user.id}/status`)
        .set(headers)
        .send({ isActive: true })
        .expect(200);

      const feed = await request(app.getHttpServer())
        .get('/api/activities')
        .set(headers)
        .query({ entityType: 'user', entityId: user.id })
        .expect(200);
      expect(feed.body.items).toHaveLength(0);
    });

    it('refuses to change the status of the caller themselves', async () => {
      const actor = await createAndLoginTestUser(app, prisma, {
        email: `self-status-${String(Date.now())}@example.com`,
        password: 'SelfPass12345',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/users/${actor.user.id}/status`)
        .set({ Authorization: `Bearer ${actor.tokens.accessToken}` })
        .send({ isActive: false })
        .expect(400);

      expect(response.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'isActive', code: 'self_status_change' }),
      ]);
      // Прапорець мусить лишитись недоторканим
      const unchanged = await prisma.user.findUnique({ where: { id: actor.user.id } });
      expect(unchanged?.isActive).toBe(true);
    });
  });
});
