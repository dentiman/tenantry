import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@saas-skeleton/database';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user with valid data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123',
          name: 'New User',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        user: {
          email: 'newuser@example.com',
          name: 'New User',
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
      expect(response.body.tokens.refreshToken).toMatch(/^[a-f0-9-]{36}:[a-f0-9]{64}$/);
    });

    it('should register a user without name', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'noname@example.com',
          password: 'SecurePass123',
        })
        .expect(201);

      expect(response.body.user.name).toBeNull();
    });

    it('should return 409 for duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'Pass1234',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'DifferentPass',
        })
        .expect(409);

      expect(response.body.message).toBe('Email already registered');
    });

    it('should return 409 for duplicate email with different casing', async () => {
      // Register with lowercase
      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'user@example.com',
          password: 'Pass1234',
        })
        .expect(201);

      // Email should be normalized to lowercase
      expect(registerResponse.body.user.email).toBe('user@example.com');

      // Try to register with mixed case - should be rejected
      const duplicateResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'User@Example.COM',
          password: 'DifferentPass',
        })
        .expect(409);

      expect(duplicateResponse.body.message).toBe('Email already registered');

      // Login should work with any casing (normalized internally)
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'USER@EXAMPLE.COM',
          password: 'Pass1234',
        })
        .expect(200);
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'SecurePass123',
        })
        .expect(400);
    });

    it('should return 400 for password too short', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'short',
        })
        .expect(400);
    });

    it('should return 400 for password too long', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'a'.repeat(129),
        })
        .expect(400);
    });

    it('should return 400 for missing required fields', async () => {
      await request(app.getHttpServer()).post('/api/auth/register').send({}).expect(400);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'test@example.com' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ password: 'SecurePass123' })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer()).post('/api/auth/register').send({
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
      const user = await prisma.user.findUnique({
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
      const response = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'refreshuser@example.com',
        password: 'RefreshPass123',
      });

      refreshToken = response.body.tokens.refreshToken;
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

    it('should invalidate old refresh token after rotation', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(response.body.message).toBe('Invalid or expired refresh token');
    });

    it('should return 401 for invalid refresh token format', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('should return 401 for non-existent refresh token', async () => {
      const fakeToken = '00000000-0000-0000-0000-000000000000:' + 'a'.repeat(64);
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

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'uuid:short' })
        .expect(401);
    });

    it('should revoke all tokens on theft detection (tampered secret)', async () => {
      // Register another user to have multiple tokens in DB
      await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'otheruser@example.com',
        password: 'OtherPass123',
      });

      // Get current user tokens
      const tokensCountBefore = await prisma.refreshToken.count({
        where: { user: { email: 'refreshuser@example.com' } },
      });

      expect(tokensCountBefore).toBe(1);

      // Tamper with the secret part of the token (simulate token theft/modification)
      const [tokenId] = refreshToken.split(':');
      const tamperedToken = `${tokenId}:${'f'.repeat(64)}`;

      // Attempt to use tampered token - should trigger theft detection
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tamperedToken })
        .expect(401);

      // All tokens for this user should be revoked due to theft detection
      const tokensAfterTheft = await prisma.refreshToken.count({
        where: { user: { email: 'refreshuser@example.com' } },
      });

      expect(tokensAfterTheft).toBe(0);

      // Other user's tokens should remain intact
      const otherUserTokens = await prisma.refreshToken.count({
        where: { user: { email: 'otheruser@example.com' } },
      });

      expect(otherUserTokens).toBe(1);
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'meuser@example.com',
        password: 'MePass123',
        name: 'Me User',
      });

      accessToken = response.body.tokens.accessToken;
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
      const response = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'guardtest@example.com',
        password: 'GuardPass123',
      });

      accessToken = response.body.tokens.accessToken;
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

    it('should allow all auth endpoints without token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'public@example.com',
          password: 'PublicPass123',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'public@example.com',
          password: 'PublicPass123',
        })
        .expect(200);
    });
  });

  describe('JWT Payload Verification', () => {
    it('should include correct user data in JWT payload', async () => {
      const registerResponse = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'jwttest@example.com',
        password: 'JwtPass123',
        name: 'JWT Test',
      });

      const accessToken = registerResponse.body.tokens.accessToken;
      const [, payloadBase64] = accessToken.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      expect(payload).toMatchObject({
        sub: registerResponse.body.user.id,
        email: 'jwttest@example.com',
        role: 'USER',
      });

      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });
});
