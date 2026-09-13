import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { resolveAllowedOrigins } from '../src/config/cors.config';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

// MT-1: POST /auth/register видалено зовсім (рішення 2026-07-16) — юзерів створює
// tenant-адмін. Setup тестів — прямий create + login (test-users.ts).

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

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
    await prisma.authSession.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('POST /api/auth/register (removed in MT-1)', () => {
    it('should not exist anymore', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePass123' })
        .expect(404);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await createTestUser(prisma, {
        email: 'loginuser@example.com',
        password: 'LoginPass123',
        name: 'Login User',
      });
    });

    it('should login with correct credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'loginuser@example.com',
          password: 'LoginPass123',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        user: {
          email: 'loginuser@example.com',
          name: 'Login User',
          role: 'USER',
          isActive: true,
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
      });

      expect(response.body.user.id).toBeDefined();
      expect(response.body.tokens.accessToken).toMatch(/^eyJ/);
      // MT-1: формат refresh-токена — tenantId:tokenId:secret
      expect(response.body.tokens.refreshToken).toMatch(
        /^[a-f0-9-]{36}:[a-f0-9-]{36}:[a-f0-9]{64}$/,
      );
    });

    it('should login with any email casing (normalized internally)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'LOGINUSER@EXAMPLE.COM',
          password: 'LoginPass123',
        })
        .expect(200);
    });

    it('should return 401 for wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'loginuser@example.com',
          password: 'WrongPassword',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid email or password');
    });

    it('should return 401 for non-existent email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid email or password');
    });

    it('should return 401 for deactivated user', async () => {
      const user = await prisma.user.findFirst({
        where: { email: 'loginuser@example.com' },
      });

      await prisma.user.update({
        where: { id: user!.id },
        data: { isActive: false },
      });

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'loginuser@example.com',
          password: 'LoginPass123',
        })
        .expect(401);

      expect(response.body.message).toBe('Account is deactivated');
    });

    it('should return 401 for suspended tenant (MT-1)', async () => {
      await prisma.tenant.update({
        where: { id: DEFAULT_TENANT_ID },
        data: { isActive: false },
      });

      try {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: 'loginuser@example.com',
            password: 'LoginPass123',
          })
          .expect(401);

        // Той самий меседж, що й для юзера — без деталізації причини
        expect(response.body.message).toBe('Account is deactivated');
      } finally {
        await prisma.tenant.update({
          where: { id: DEFAULT_TENANT_ID },
          data: { isActive: true },
        });
      }
    });

    it('should return 400 for invalid request format', async () => {
      await request(app.getHttpServer()).post('/api/auth/login').send({}).expect(400);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'test@example.com' })
        .expect(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const { tokens } = await createAndLoginTestUser(app, prisma, {
        email: 'refreshuser@example.com',
        password: 'RefreshPass123',
      });
      refreshToken = tokens.refreshToken;
    });

    it('should refresh access token with valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });

      expect(response.body.accessToken).toMatch(/^eyJ/);
      expect(response.body.refreshToken).not.toBe(refreshToken);
    });

    it('should invalidate the old refresh token once the rotation window closes', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // AUTH-1: одразу після ротації старий токен ще приймається — це вікно (60 с)
      // існує рівно для того, щоб гонка двох вкладок не виглядала як крадіжка.
      // Деталі поведінки — auth-sessions.e2e-spec.ts
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Зсуваємо момент ротації в минуле — вікно зачинене, це вже reuse
      const sid = refreshToken.split(':')[1] ?? '';
      await prisma.authSession.update({
        where: { id: sid },
        data: { prevRotatedAt: new Date(Date.now() - 2 * 60 * 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('should return 401 for invalid refresh token format', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('should return 401 for non-existent refresh token', async () => {
      const fakeToken = `${DEFAULT_TENANT_ID}:00000000-0000-0000-0000-000000000000:${'a'.repeat(64)}`;
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: fakeToken })
        .expect(401);
    });

    it('should return 401 for malformed refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'malformed' })
        .expect(401);

      // Старий (до-MT) формат tokenId:secret — тепер невалідний
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'uuid:short' })
        .expect(401);
    });

    it('should return 401 for token with mismatched tenant prefix', async () => {
      // Зшитий токен: чужий (неіснуючий) tenant + валідні tokenId:secret
      const [, tokenId, secret] = refreshToken.split(':');
      const stitched = `11111111-1111-1111-1111-111111111111:${tokenId}:${secret}`;
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: stitched })
        .expect(401);
    });

    it('should revoke the session (and only it) when the secret does not match', async () => {
      // Інший юзер — щоб переконатись, що чужі сесії не зачепило
      await createAndLoginTestUser(app, prisma, {
        email: 'otheruser@example.com',
        password: 'OtherPass123',
      });

      // Підмінений секрет при живому sid
      const [tenantId, sid] = refreshToken.split(':');
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: `${tenantId}:${sid}:${'f'.repeat(64)}` })
        .expect(401);

      // AUTH-1: сесія відкликана, а НЕ видалена — рядок лишається слідом інциденту
      const session = await prisma.authSession.findUnique({ where: { id: sid } });
      expect(session?.revokedReason).toBe('secret_mismatch');
      expect(session?.revokedAt).not.toBeNull();

      // Чужий юзер не постраждав
      expect(
        await prisma.authSession.count({
          where: { user: { email: 'otheruser@example.com' }, revokedAt: null },
        }),
      ).toBe(1);
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const { tokens } = await createAndLoginTestUser(app, prisma, {
        email: 'meuser@example.com',
        password: 'MePass123',
        name: 'Me User',
      });
      accessToken = tokens.accessToken;
    });

    it('should return current user profile with valid access token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: 'meuser@example.com',
        name: 'Me User',
        role: 'USER',
        isActive: true,
      });

      expect(response.body.id).toBeDefined();
      expect(response.body.passwordHash).toBeUndefined();
      // MT-1: tenantId — внутрішня колонка, назовні не віддається
      expect(response.body.tenantId).toBeUndefined();
    });

    it('should return 401 without Authorization header', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/me').expect(401);

      expect(response.body.message).toBe('Missing access token');
    });

    it('should return 401 with invalid token format', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should return 401 with malformed Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'InvalidFormat')
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', accessToken)
        .expect(401);
    });

    it('should return 401 with expired token', async () => {
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjF9.invalid';

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });
  });

  describe('Global Guard Integration', () => {
    let accessToken: string;

    beforeEach(async () => {
      const { tokens } = await createAndLoginTestUser(app, prisma, {
        email: 'guardtest@example.com',
        password: 'GuardPass123',
      });
      accessToken = tokens.accessToken;
    });

    it('should allow access to public health endpoint without token', async () => {
      const response = await request(app.getHttpServer()).get('/api/health').expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('should block access to protected users endpoint without token', async () => {
      await request(app.getHttpServer()).get('/api/users?page=1&limit=10').expect(401);
    });

    it('should allow access to protected users endpoint with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    });

    it('should allow auth endpoints without token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'guardtest@example.com',
          password: 'GuardPass123',
        })
        .expect(200);
    });
  });

  // AUTH-0 (FR-008, FR-009): CORS-allowlist і захисні заголовки
  describe('HTTP hardening', () => {
    it('answers CORS only for an allowed origin', async () => {
      const [allowedOrigin] = resolveAllowedOrigins();

      const allowed = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', allowedOrigin ?? '')
        .expect(200);
      expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');

      const foreign = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sets security headers and hides the framework', async () => {
      const response = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('JWT Payload Verification', () => {
    it('should include correct user data in JWT payload', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, prisma, {
        email: 'jwttest@example.com',
        password: 'JwtPass123',
        name: 'JWT Test',
      });

      const payloadBase64 = tokens.accessToken.split('.')[1] ?? '';
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      expect(payload).toMatchObject({
        sub: user.id,
        email: 'jwttest@example.com',
        role: 'USER',
        // MT-1: tenantId у клеймах — З РЯДКА БД
        tenantId: DEFAULT_TENANT_ID,
      });

      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });
});
