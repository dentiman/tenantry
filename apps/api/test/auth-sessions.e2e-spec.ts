/// <reference types="jest" />

// AUTH-1: сесія = пристрій. Головне, що тут перевіряється, — не окремі поля, а три
// властивості, заради яких `refresh_tokens` і замінили на `auth_sessions`:
// (1) `sid` переживає ротацію, тож сесію можна показати і вибірково вбити;
// (2) повторне використання токена відрізняється від гонки двох вкладок;
// (3) відкликана сесія лишається рядком — слідом, а не порожнім місцем.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  createAndLoginTestUser,
  loginTestUser,
  refreshTokenFromCookie,
  DEFAULT_TENANT_ID,
} from './test-users';

const EMAIL = 'sessions-owner@example.com';
const PASSWORD = 'SessionsPass12345';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

describe('Auth sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let userId: string;
  let tokens: { accessToken: string; refreshToken: string };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
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
      name: 'Sessions Owner',
    });
    userId = created.user.id;
    tokens = created.tokens;
  });

  const refresh = (refreshToken: string, userAgent = CHROME_MAC): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('User-Agent', userAgent)
      .send({ refreshToken });

  const login = (userAgent: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('User-Agent', userAgent)
      .send({ email: EMAIL, password: PASSWORD });

  const sid = (refreshToken: string): string => refreshToken.split(':')[1] ?? '';

  describe('створення і ротація', () => {
    it('логін створює рівно одну сесію з підписом пристрою', async () => {
      await prisma.authSession.deleteMany({});
      const response = await login(CHROME_MAC).expect(200);
      const issuedRefreshToken = refreshTokenFromCookie(response);

      const sessions = await prisma.authSession.findMany({ where: { userId } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: sid(issuedRefreshToken),
        userAgent: CHROME_MAC,
        deviceLabel: 'Chrome on macOS',
        generation: 0,
        revokedAt: null,
      });
      // ip приходить від express (`trust proxy`); у e2e це петля, але воно мусить бути
      expect(sessions[0]?.ip).toEqual(expect.any(String));
    });

    it('ротація зберігає sid, піднімає generation і посуває ТІЛЬКИ idle', async () => {
      const before = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid(tokens.refreshToken) },
      });

      const response = await refresh(tokens.refreshToken).expect(200);
      const rotated = refreshTokenFromCookie(response);

      // Той самий пристрій — той самий рядок; це і є вся суть фази
      expect(sid(rotated)).toBe(before.id);
      expect(rotated).not.toBe(tokens.refreshToken);

      const after = await prisma.authSession.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.generation).toBe(1);
      expect(after.idleExpiresAt.getTime()).toBeGreaterThan(before.idleExpiresAt.getTime());
      // Absolute — стеля від логіну: ротація не має права її подовжувати
      expect(after.absoluteExpiresAt.getTime()).toBe(before.absoluteExpiresAt.getTime());
      expect(after.prevTokenHash).not.toBeNull();
      expect(after.tokenHash.startsWith('sha256:')).toBe(true);
    });
  });

  describe('строки життя', () => {
    it('прострочений absolute відмовляє навіть із правильним секретом', async () => {
      await prisma.authSession.update({
        where: { id: sid(tokens.refreshToken) },
        data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(tokens.refreshToken).expect(401);
    });

    it('прострочений idle відмовляє', async () => {
      await prisma.authSession.update({
        where: { id: sid(tokens.refreshToken) },
        data: { idleExpiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(tokens.refreshToken).expect(401);
    });
  });

  describe('повторне використання токена', () => {
    it('у вікні — це гонка вкладок, а не крадіжка: 200 без стрибка generation', async () => {
      const first = await refresh(tokens.refreshToken).expect(200);
      expect(refreshTokenFromCookie(first)).toEqual(expect.any(String));

      // Той самий (уже ротований) токен одразу після ротації
      await refresh(tokens.refreshToken).expect(200);

      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid(tokens.refreshToken) },
      });
      expect(session.generation).toBe(1);
      expect(session.revokedAt).toBeNull();
    });

    it('дві паралельні ротації тим самим токеном дають сумарно +1', async () => {
      const [a, b] = await Promise.all([refresh(tokens.refreshToken), refresh(tokens.refreshToken)]);
      expect([a.status, b.status]).toEqual([200, 200]);

      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid(tokens.refreshToken) },
      });
      expect(session.generation).toBe(1);
    });

    it('поза вікном — відкликає сесію, шле сповіщення і пише активність', async () => {
      const other = await loginTestUser(app, EMAIL, PASSWORD);
      await refresh(tokens.refreshToken).expect(200);

      // Зсуваємо момент ротації на 2 хвилини назад — вікно (60 с) уже зачинене
      await prisma.authSession.update({
        where: { id: sid(tokens.refreshToken) },
        data: { prevRotatedAt: new Date(Date.now() - 2 * 60 * 1000) },
      });

      await refresh(tokens.refreshToken).expect(401);

      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid(tokens.refreshToken) },
      });
      expect(session.revokedReason).toBe('rotation_reuse');
      expect(session.revokedAt).not.toBeNull();

      // Друга сесія того ж юзера жива: один викрадений токен не вибиває всі пристрої
      await refresh(other.refreshToken).expect(200);

      const notification = await prisma.notification.findFirst({
        where: { type: 'auth.session_reuse_detected', recipientId: userId },
      });
      expect(notification).not.toBeNull();

      const activity = await prisma.activity.findFirst({
        where: { type: 'user.sessions_revoked' },
      });
      // Актор — система: цю дію не ініціювала людина
      expect(activity?.actorType).toBe('system');
      expect(activity?.payload).toMatchObject({ reason: 'rotation_reuse', sessionCount: 1 });
    });

    it('невідомий секрет відкликає сесію з причиною secret_mismatch', async () => {
      const [tenantId, id] = tokens.refreshToken.split(':');
      await refresh(`${tenantId}:${id}:${'a'.repeat(64)}`).expect(401);

      const session = await prisma.authSession.findUniqueOrThrow({ where: { id: id ?? '' } });
      expect(session.revokedReason).toBe('secret_mismatch');
    });

    it('чужий префікс тенанта відмовляє', async () => {
      const [, id, secret] = tokens.refreshToken.split(':');
      await refresh(`11111111-1111-4111-8111-111111111111:${id}:${secret}`).expect(401);
    });
  });

  describe('міграційний шлях зі старих refresh_tokens', () => {
    it('argon2-хеш верифікується, а після ротації переписується на sha256', async () => {
      const secret = 'legacy-secret-value';
      const legacy = await prisma.authSession.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          userId,
          // Рівно те, що робить INSERT … SELECT у міграції
          tokenHash: `argon2:${await argon2.hash(secret)}`,
          idleExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });

      await refresh(`${DEFAULT_TENANT_ID}:${legacy.id}:${secret}`).expect(200);

      const after = await prisma.authSession.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(after.tokenHash.startsWith('sha256:')).toBe(true);
    });
  });

  describe('GET /api/account/sessions', () => {
    it('показує живі сесії, поточну першою і без жодного секрету', async () => {
      await login(FIREFOX_WINDOWS).expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/account/sessions')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const list = response.body as Record<string, unknown>[];
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({ id: sid(tokens.refreshToken), isCurrent: true });
      expect(list[1]).toMatchObject({ isCurrent: false, deviceLabel: 'Firefox on Windows' });

      // Секрети і причини відкликання за межу мапера не виходять
      for (const item of list) {
        expect(item.tokenHash).toBeUndefined();
        expect(item.prevTokenHash).toBeUndefined();
        expect(item.revokedAt).toBeUndefined();
        expect(item.revokedReason).toBeUndefined();
      }
    });
  });

  describe('DELETE /api/account/sessions/:id', () => {
    it('завершує власну сесію і пише активність із причиною', async () => {
      const other = await loginTestUser(app, EMAIL, PASSWORD);

      await request(app.getHttpServer())
        .delete(`/api/account/sessions/${sid(other.refreshToken)}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(204);

      await refresh(other.refreshToken).expect(401);
      // Поточна сесія лишилась живою — вбивали рівно один пристрій
      await refresh(tokens.refreshToken).expect(200);

      const session = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid(other.refreshToken) },
      });
      expect(session.revokedReason).toBe('user');

      const activity = await prisma.activity.findFirst({ where: { type: 'user.sessions_revoked' } });
      expect(activity?.payload).toMatchObject({ reason: 'user', sessionCount: 1 });
    });

    it('чужа сесія — 404, і рядок лишається живим', async () => {
      const stranger = await createAndLoginTestUser(app, prisma, {
        email: 'stranger@example.com',
        password: 'StrangerPass12345',
      });

      await request(app.getHttpServer())
        .delete(`/api/account/sessions/${sid(stranger.tokens.refreshToken)}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(404);

      // 404, а не 403: різниця між «немає» і «не твоя» — це оракул
      await refresh(stranger.tokens.refreshToken).expect(200);
    });

    it('неіснуюча сесія — теж 404', async () => {
      await request(app.getHttpServer())
        .delete('/api/account/sessions/22222222-2222-4222-8222-222222222222')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(404);
    });
  });

  describe('масове відкликання', () => {
    it('зміна пароля відкликає все, рядки лишаються, поточний пристрій отримує робочу пару', async () => {
      const other = await loginTestUser(app, EMAIL, PASSWORD);

      const response = await request(app.getHttpServer())
        .post('/api/account/password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass12345' })
        .expect(200);

      await refresh(other.refreshToken).expect(401);
      await refresh(tokens.refreshToken).expect(401);
      await refresh(refreshTokenFromCookie(response)).expect(200);

      // Саме відкликані, а не видалені
      const revoked = await prisma.authSession.findMany({
        where: { userId, revokedReason: 'password_change' },
      });
      expect(revoked).toHaveLength(2);
      expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('revoke-all ставить причину revoke_all усім сесіям', async () => {
      await loginTestUser(app, EMAIL, PASSWORD);

      await request(app.getHttpServer())
        .post('/api/account/sessions/revoke-all')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const revoked = await prisma.authSession.count({
        where: { userId, revokedReason: 'revoke_all' },
      });
      expect(revoked).toBe(2);
    });
  });

  describe('сповіщення про новий пристрій', () => {
    it('приходить на незнайомий User-Agent і не повторюється на знайомий', async () => {
      await prisma.notification.deleteMany({});

      await login(FIREFOX_WINDOWS).expect(200);
      const first = await prisma.notification.findMany({
        where: { type: 'auth.new_device', recipientId: userId },
      });
      expect(first).toHaveLength(1);
      expect(first[0]?.payload).toMatchObject({ deviceLabel: 'Firefox on Windows' });

      // Другий вхід із того самого пристрою за наявності живої сесії — мовчить
      await login(FIREFOX_WINDOWS).expect(200);
      expect(
        await prisma.notification.count({
          where: { type: 'auth.new_device', recipientId: userId },
        }),
      ).toBe(1);
    });
  });
});

/**
 * Друга політика реакції на reuse — окремий застосунок, бо `AUTH_REUSE_REVOKES_ALL_SESSIONS`
 * читається ConfigModule-ом на старті. Дефолт (вибити лише скомпрометовану сесію)
 * перевірено вище; тут — форк із суворішим профілем ризику.
 */
describe('Auth sessions: reuse вибиває всі сесії (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.AUTH_REUSE_REVOKES_ALL_SESSIONS;
    process.env.AUTH_REUSE_REVOKES_ALL_SESSIONS = 'true';

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    prisma = moduleFixture.get(SystemPrismaService);
    await app.init();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.AUTH_REUSE_REVOKES_ALL_SESSIONS;
    } else {
      process.env.AUTH_REUSE_REVOKES_ALL_SESSIONS = previous;
    }
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    await app.close();
  });

  it('reuse поза вікном відкликає ВСІ сесії юзера', async () => {
    await prisma.authSession.deleteMany({});
    await prisma.user.deleteMany({});

    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: 'reuse-strict@example.com',
      password: PASSWORD,
    });
    await loginTestUser(app, 'reuse-strict@example.com', PASSWORD);

    const sessionId = tokens.refreshToken.split(':')[1] ?? '';
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    await prisma.authSession.update({
      where: { id: sessionId },
      data: { prevRotatedAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    const alive = await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } });
    expect(alive).toBe(0);
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedReason: 'rotation_reuse' },
      }),
    ).toBe(2);
  });
});
