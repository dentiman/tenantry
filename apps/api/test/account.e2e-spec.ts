import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, loginTestUser, refreshTokenFromCookie } from './test-users';

/**
 * Self-service акаунт (V1 «рівень 0»): профіль, зміна власного пароля, «вийти
 * звідусіль» і здача токена на виході. Сесії як сутності в моделі немає — тому
 * тут перевіряється саме те, що обіцяно: все або нічого.
 */
describe('Account (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  const EMAIL = 'account-owner@example.com';
  const PASSWORD = 'OwnerPass123';

  let tokens: { accessToken: string; refreshToken: string };
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    prisma = moduleFixture.get(SystemPrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.activityLink.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.authSession.deleteMany({});
    await prisma.user.deleteMany({});

    const created = await createAndLoginTestUser(app, prisma, {
      email: EMAIL,
      password: PASSWORD,
      name: 'Account Owner',
    });
    tokens = created.tokens;
    userId = created.user.id;
  });

  describe('GET /api/account', () => {
    it('should return own profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/account')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ id: userId, email: EMAIL, name: 'Account Owner' });
      // Хеш пароля не витікає навіть у self-service відповіді
      expect(response.body.passwordHash).toBeUndefined();
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer()).get('/api/account').expect(401);
    });
  });

  describe('PATCH /api/account/profile', () => {
    it('should update own name, phone and locale', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/account/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ name: 'Renamed Owner', phone: '+380671234567', locale: 'en' })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Renamed Owner',
        phone: '+380671234567',
        // Країна виводиться з номера — пара тримається узгодженою в UsersService
        phoneCountry: 'UA',
      });
    });

    it('should ignore role and email - they are not part of the self-service contract', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/account/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ name: 'Still USER', role: 'ADMIN', email: 'hijack@example.com' })
        .expect(200);

      expect(response.body).toMatchObject({ name: 'Still USER', role: 'USER', email: EMAIL });
    });
  });

  describe('POST /api/account/password', () => {
    it('should reject a wrong current password with a field error', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/account/password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: 'NotMyPassword1', newPassword: 'BrandNewPass123' })
        .expect(400);

      expect(response.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'currentPassword', code: 'invalid_current_password' }),
      ]);

      // Пароль лишився старим
      await loginTestUser(app, EMAIL, PASSWORD);
    });

    it('should change the password, revoke every session and hand back a fresh pair', async () => {
      // Друга сесія того самого юзера — вона мусить померти
      const other = await loginTestUser(app, EMAIL, PASSWORD);

      const response = await request(app.getHttpServer())
        .post('/api/account/password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass123' })
        .expect(200);

      const fresh = { refreshToken: refreshTokenFromCookie(response) };
      expect(fresh.refreshToken).toEqual(expect.any(String));

      // Стара сесія (і та, з якої міняли, і чужа вкладка) більше не оновлюється
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: other.refreshToken })
        .expect(401);

      // Повернута пара робоча — свою дію юзер не переживає виходом на /login
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: fresh.refreshToken })
        .expect(200);

      // Новий пароль діє, старий — ні
      await loginTestUser(app, EMAIL, 'BrandNewPass123');
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(401);
    });
  });

  describe('POST /api/account/sessions/revoke-all', () => {
    it('should kill other sessions, keep the caller signed in and journal the fact', async () => {
      const other = await loginTestUser(app, EMAIL, PASSWORD);

      const response = await request(app.getHttpServer())
        .post('/api/account/sessions/revoke-all')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const fresh = { refreshToken: refreshTokenFromCookie(response) };

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: other.refreshToken })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: fresh.refreshToken })
        .expect(200);

      const activity = await prisma.activity.findFirst({
        where: { type: 'user.sessions_revoked' },
      });
      expect(activity).not.toBeNull();
      // Дві сесії на момент виклику: початкова і other
      expect(activity?.payload).toMatchObject({ sessionCount: 2 });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke the surrendered token and stay idempotent', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      // Повторний вихід тим самим токеном — теж 204, без деталізації
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(204);
    });

    it('should ignore a token with a wrong secret instead of revoking it', async () => {
      const [tenantId, tokenId] = tokens.refreshToken.split(':');

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: `${tenantId}:${tokenId}:deadbeef` })
        .expect(204);

      // Сесія жива: підробленим секретом чужий вихід не влаштувати
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);
    });
  });
});
