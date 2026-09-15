/// <reference types="jest" />

// AUTH-3: відновлення доступу і зміна email (US4). Три властивості, заради яких
// це окремий флоу, а не варіація на логін:
// (1) скидання пароля без оракула — відповідь однакова для будь-якого email;
// (2) токен шифрується перед публікацією (`pgboss.job` поза RLS);
// (3) кілл-свіч — деактивований юзер/тенант зупиняють confirm ДО споживання токена.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaService, VerificationPurpose } from '@saas-skeleton/database';
import { CryptoService, PgBossService } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createTestUser, loginTestUser, DEFAULT_TENANT_ID } from './test-users';

interface SendEnvelope {
  data: Record<string, unknown>;
}
type SendCall = [string, SendEnvelope, unknown?];

/** Знаходить перший виклик send() на чергу, ім'я якої містить фрагмент */
function findSendCall(spy: jest.SpyInstance, queueFragment: string): SendEnvelope {
  const calls = spy.mock.calls as unknown as SendCall[];
  const call = calls.find(([queue]) => queue.includes(queueFragment));
  if (!call) {
    throw new Error(`No pg-boss send() call found for queue containing "${queueFragment}"`);
  }
  return call[1];
}

describe('Auth recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let crypto: CryptoService;
  let pgBoss: PgBossService;

  const PASSWORD = 'CurrentPass12345';
  let userSuffix = 0;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    prisma = moduleFixture.get(SystemPrismaService);
    crypto = moduleFixture.get(CryptoService);
    pgBoss = moduleFixture.get(PgBossService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Кожен тест — свій email: спільна throttler-стеля password-reset (3/год) б'є по email+ip */
  async function seedUser(overrides: { isActive?: boolean } = {}) {
    userSuffix += 1;
    return createTestUser(prisma, {
      email: `recovery-${String(userSuffix)}-${String(Date.now())}@example.com`,
      password: PASSWORD,
      ...overrides,
    });
  }

  describe('POST /auth/password-reset', () => {
    it('неіснуючий email → 204 і жодної опублікованої події', async () => {
      const sendSpy = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/auth/password-reset')
        .send({ email: `nobody-${String(Date.now())}@example.com` })
        .expect(204);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('існуючий email → 204 і рівно одна подія auth.password-reset-requested.v1 з tokenEncrypted', async () => {
      const user = await seedUser();
      const sendSpy = jest.spyOn(pgBoss.boss, 'send');

      await request(app.getHttpServer())
        .post('/api/auth/password-reset')
        .send({ email: user.email })
        .expect(204);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const envelope = findSendCall(sendSpy, 'password-reset-requested');
      expect(envelope.data.userId).toBe(user.id);
      const tokenEncrypted = envelope.data.tokenEncrypted as string;
      expect(tokenEncrypted).toMatch(/^v1:/);
      expect(envelope.data).not.toHaveProperty('token');
      // Робочий шифротекст — розшифровується назад тим самим ключем
      expect(() => crypto.decrypt(tokenEncrypted)).not.toThrow();
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    async function requestAndExtractToken(email: string): Promise<string> {
      const sendSpy = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/auth/password-reset')
        .send({ email })
        .expect(204);
      const envelope = findSendCall(sendSpy, 'password-reset-requested');
      sendSpy.mockRestore();
      return crypto.decrypt(envelope.data.tokenEncrypted as string);
    }

    it('повний цикл: токен → confirm → новий пароль працює, старий 401, попередні сесії мертві', async () => {
      const user = await seedUser();
      const oldTokens = await loginTestUser(app, user.email, PASSWORD);
      const token = await requestAndExtractToken(user.email);

      const newPassword = 'BrandNewPass456';
      const confirmed = await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token, newPassword })
        .expect(200);

      expect(confirmed.body.user.email).toBe(user.email);
      expect(confirmed.body.tokens.accessToken).toMatch(/^eyJ/);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: newPassword })
        .expect(200);

      // Сесія, що існувала ДО скидання, мертва (перехідний шлях — токен у тілі)
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: oldTokens.refreshToken })
        .expect(401);

      const activity = await prisma.activity.findFirst({
        where: { type: 'user.password_changed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(activity?.actorType).toBe('user');
      expect(activity?.actorId).toBe(user.id);

      // spec FR-021: жодної окремої user.sessions_revoked для цього шляху. Скоуп по
      // actorId ЦЬОГО юзера — глобальний count ловив би сесії, відкликані в інших
      // сьютах (account.e2e-spec.ts тощо), що ганяються в тій самій тестовій БД
      const revoked = await prisma.activity.count({
        where: { type: 'user.sessions_revoked', actorId: user.id },
      });
      expect(revoked).toBe(0);
    });

    it('повторний confirm тим самим токеном → 400, пароль не змінюється вдруге', async () => {
      const user = await seedUser();
      const token = await requestAndExtractToken(user.email);

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token, newPassword: 'FirstNewPass123' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token, newPassword: 'SecondNewPass456' })
        .expect(400);

      // Другий пароль НЕ застосувався — перший лишається робочим
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'FirstNewPass123' })
        .expect(200);
    });

    it('прострочений токен (expires_at у минулому) → 400', async () => {
      const user = await seedUser();
      const token = await requestAndExtractToken(user.email);

      await prisma.verificationToken.updateMany({
        where: { userId: user.id, purpose: VerificationPurpose.PASSWORD_RESET },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token, newPassword: 'ShouldNotApply123' })
        .expect(400);
    });

    it('перевидача токена інвалідує попередній', async () => {
      const user = await seedUser();
      const firstToken = await requestAndExtractToken(user.email);
      const secondToken = await requestAndExtractToken(user.email);

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token: firstToken, newPassword: 'ViaOldToken12345' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token: secondToken, newPassword: 'ViaNewToken12345' })
        .expect(200);
    });

    it('деактивований юзер між запитом і confirm → 400, пароль не змінився, сесії не видано, used_at лишився null', async () => {
      const user = await seedUser();
      const token = await requestAndExtractToken(user.email);

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token, newPassword: 'ShouldNotApply123' })
        .expect(400);

      const stored = await prisma.verificationToken.findFirst({
        where: { userId: user.id, purpose: VerificationPurpose.PASSWORD_RESET },
      });
      expect(stored?.usedAt).toBeNull();

      const sessionCount = await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(sessionCount).toBe(0);
    });
  });

  describe('Токени purpose і tenant — перехресна недійсність', () => {
    it('токен PASSWORD_RESET не приймається на email-change/confirm і навпаки', async () => {
      const user = await seedUser();

      const sendSpy = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/auth/password-reset')
        .send({ email: user.email })
        .expect(204);
      const resetToken = crypto.decrypt(
        findSendCall(sendSpy, 'password-reset-requested').data.tokenEncrypted as string,
      );
      sendSpy.mockRestore();

      await request(app.getHttpServer())
        .post('/api/account/email-change/confirm')
        .send({ token: resetToken })
        .expect(400);

      const loginTokens = await loginTestUser(app, user.email, PASSWORD);
      const sendSpy2 = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/account/email-change')
        .set('Authorization', `Bearer ${loginTokens.accessToken}`)
        .send({ newEmail: `changed-${String(Date.now())}@example.com`, currentPassword: PASSWORD })
        .expect(204);
      const changeToken = crypto.decrypt(
        findSendCall(sendSpy2, 'email-change-requested').data.tokenEncrypted as string,
      );
      sendSpy2.mockRestore();

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token: changeToken, newPassword: 'WontApply12345' })
        .expect(400);
    });

    it('токен з підміненим префіксом тенанта → 400', async () => {
      const user = await seedUser();
      const token = await (async () => {
        const sendSpy = jest.spyOn(pgBoss.boss, 'send');
        await request(app.getHttpServer())
          .post('/api/auth/password-reset')
          .send({ email: user.email })
          .expect(204);
        const raw = crypto.decrypt(
          findSendCall(sendSpy, 'password-reset-requested').data.tokenEncrypted as string,
        );
        sendSpy.mockRestore();
        return raw;
      })();

      const [, id, secret] = token.split(':');
      const forged = `00000000-0000-4000-8000-000000000099:${String(id)}:${String(secret)}`;

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ token: forged, newPassword: 'WontApply12345' })
        .expect(400);
    });
  });

  describe('Зміна email', () => {
    it('невірний currentPassword → 400 з fieldErrors.currentPassword', async () => {
      const user = await seedUser();
      const tokens = await loginTestUser(app, user.email, PASSWORD);

      const response = await request(app.getHttpServer())
        .post('/api/account/email-change')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ newEmail: `new-${String(Date.now())}@example.com`, currentPassword: 'WrongPass123' })
        .expect(400);

      expect(response.body.fieldErrors?.[0]?.field).toBe('currentPassword');
    });

    it('підтвердження змінює email, публікує auth.email-changed.v1 і пише user.email_changed', async () => {
      const user = await seedUser();
      const tokens = await loginTestUser(app, user.email, PASSWORD);
      const newEmail = `changed-${String(Date.now())}@example.com`;

      const sendSpy = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/account/email-change')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ newEmail, currentPassword: PASSWORD })
        .expect(204);
      const changeToken = crypto.decrypt(
        findSendCall(sendSpy, 'email-change-requested').data.tokenEncrypted as string,
      );

      const confirmed = await request(app.getHttpServer())
        .post('/api/account/email-change/confirm')
        .send({ token: changeToken })
        .expect(200);
      expect(confirmed.body.email).toBe(newEmail);

      // auth.email-changed.v1 — на СТАРУ адресу, публікується всередині confirm
      expect(sendSpy).toHaveBeenCalled();
      const changedEnvelope = findSendCall(sendSpy, 'email-changed.v1');
      expect(changedEnvelope.data.previousEmail).toBe(user.email);

      const activity = await prisma.activity.findFirst({
        where: { type: 'user.email_changed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(activity?.payload).toMatchObject({ from: user.email, to: newEmail });

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated?.email).toBe(newEmail);
    });

    it('адресу зайняли між запитом і підтвердженням → 409 з fieldErrors.email', async () => {
      const user = await seedUser();
      const tokens = await loginTestUser(app, user.email, PASSWORD);
      const contestedEmail = `contested-${String(Date.now())}@example.com`;

      const sendSpy = jest.spyOn(pgBoss.boss, 'send');
      await request(app.getHttpServer())
        .post('/api/account/email-change')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ newEmail: contestedEmail, currentPassword: PASSWORD })
        .expect(204);
      const changeToken = crypto.decrypt(
        findSendCall(sendSpy, 'email-change-requested').data.tokenEncrypted as string,
      );

      // Хтось інший встиг зареєструвати ту саму адресу до кліку по лінку
      await createTestUser(prisma, { email: contestedEmail, password: 'OtherPass12345' });

      const response = await request(app.getHttpServer())
        .post('/api/account/email-change/confirm')
        .send({ token: changeToken })
        .expect(409);
      expect(response.body.fieldErrors?.[0]?.field).toBe('email');
    });
  });
});
