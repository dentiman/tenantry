/// <reference types="jest" />

// MT-3: control plane e2e — операторський auth, CRUD тенантів, моніторинг черг,
// security boundary між plane-ами (токени не крос-валідні).

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Redis } from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { validatePlatformEnv } from '../src/config/env.schema';
import { REDIS_THROTTLER_CLIENT } from '../src/redis/redis.constants';
import { SystemPrismaService } from '@saas-skeleton/database';

const OPERATOR_EMAIL = 'operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';

describe('Platform API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

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
    await prisma.platformUser.deleteMany();
    // tenants створюються тестами — чистимо все, крім дефолтного (він із міграції)
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { not: 'default' } } });
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'Operator',
        passwordHash: await argon2.hash(OPERATOR_PASSWORD),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const loginOperator = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    return String(response.body.accessToken);
  };

  // AUTH-0 (FR-010): небезпечний секрет валить старт control plane
  describe('env validation', () => {
    const strongSecret = 'p'.repeat(20) + 'Q'.repeat(20);

    it('accepts a strong PLATFORM_JWT_SECRET', () => {
      expect(() => validatePlatformEnv({ PLATFORM_JWT_SECRET: strongSecret })).not.toThrow();
    });

    it('does NOT fall back to JWT_SECRET (окремий секрет — security boundary)', () => {
      expect(() => validatePlatformEnv({ JWT_SECRET: strongSecret })).toThrow(
        /PLATFORM_JWT_SECRET/,
      );
    });

    it('rejects a short secret and the literal value from .env.example', () => {
      expect(() => validatePlatformEnv({ PLATFORM_JWT_SECRET: 'x'.repeat(31) })).toThrow(
        /PLATFORM_JWT_SECRET/,
      );
      expect(() =>
        validatePlatformEnv({
          PLATFORM_JWT_SECRET: 'change-me-platform-secret-min-32-chars-key-here',
        }),
      ).toThrow(/PLATFORM_JWT_SECRET/);
    });
  });

  describe('platform auth', () => {
    it('logs an operator in and serves /auth/me', async () => {
      const token = await loginOperator();
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.email).toBe(OPERATOR_EMAIL);
      expect(me.body.passwordHash).toBeUndefined();
    });

    it('rejects wrong credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OPERATOR_EMAIL, password: 'WrongPass123' })
        .expect(401);
    });

    it('protects endpoints without token', async () => {
      await request(app.getHttpServer()).get('/api/tenants').expect(401);
      await request(app.getHttpServer()).get('/api/jobs?page=1&limit=10').expect(401);
    });

    it('rejects a TENANT-plane token (інший секрет — security boundary)', async () => {
      // Токен, підписаний tenant-секретом (JWT_SECRET) — формально валідний JWT
      // з валідними клеймами, але для platform-guard він чужий
      const tenantJwt = new JwtService({
        secret: process.env.JWT_SECRET ?? 'ci-only-secret-not-for-production-min-32-chars',
        signOptions: { expiresIn: '15m' },
      });
      const foreignToken = await tenantJwt.signAsync({
        sub: 'x',
        email: 'x@x.com',
        role: 'ADMIN',
        tenantId: '00000000-0000-4000-8000-000000000001',
      });

      await request(app.getHttpServer())
        .get('/api/tenants')
        .set('Authorization', `Bearer ${foreignToken}`)
        .expect(401);
    });
  });

  describe('tenants CRUD', () => {
    it('creates a tenant with its first admin atomically', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'acme',
          name: 'Acme Inc',
          admin: { email: 'boss@acme.test', password: 'AcmeAdmin123', name: 'Boss' },
        })
        .expect(201);

      expect(response.body).toMatchObject({ slug: 'acme', name: 'Acme Inc', isActive: true });

      const admin = await prisma.user.findFirst({ where: { email: 'boss@acme.test' } });
      expect(admin?.tenantId).toBe(String(response.body.id));
      expect(admin?.role).toBe('ADMIN');
    });

    it('rejects duplicate slug with 409 field error', async () => {
      const token = await loginOperator();
      const payload = {
        slug: 'dup-tenant',
        name: 'Dup',
        admin: { email: 'dup@dup.test', password: 'DupAdmin1234' },
      };
      await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...payload, admin: { email: 'other@dup.test', password: 'DupAdmin1234' } })
        .expect(409);
      expect(response.body.fieldErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'slug' })]),
      );
    });

    it('rejects invalid slug format with 400', async () => {
      const token = await loginOperator();
      await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'Not A Slug!',
          name: 'Bad',
          admin: { email: 'bad@bad.test', password: 'BadAdmin1234' },
        })
        .expect(400);
    });

    it('suspends and resumes a tenant', async () => {
      const token = await loginOperator();
      const created = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'pausable',
          name: 'Pausable',
          admin: { email: 'p@p.test', password: 'PauseAdmin123' },
        })
        .expect(201);
      const id = String(created.body.id);

      const suspended = await request(app.getHttpServer())
        .patch(`/api/tenants/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);
      expect(suspended.body.isActive).toBe(false);

      const resumed = await request(app.getHttpServer())
        .patch(`/api/tenants/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: true })
        .expect(200);
      expect(resumed.body.isActive).toBe(true);
    });

    it('lists tenants including the default one', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const slugs = (response.body.items as { slug: string }[]).map((t) => t.slug);
      expect(slugs).toContain('default');
    });

    it('finds tenants by search on slug and name', async () => {
      const token = await loginOperator();
      await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'searchable-slug',
          name: 'Findable Name Inc',
          admin: { email: 'search@example.test', password: 'SearchAdmin123' },
        })
        .expect(201);

      const bySlug = await request(app.getHttpServer())
        .get('/api/tenants?search=searchable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((bySlug.body.items as { slug: string }[]).map((t) => t.slug)).toContain(
        'searchable-slug',
      );

      const byName = await request(app.getHttpServer())
        .get('/api/tenants?search=Findable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((byName.body.items as { slug: string }[]).map((t) => t.slug)).toContain(
        'searchable-slug',
      );
    });

    it('filters tenants by isActive=false to only suspended ones', async () => {
      const token = await loginOperator();
      const created = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'to-suspend',
          name: 'To Suspend',
          admin: { email: 'suspend@example.test', password: 'SuspendAdmin123' },
        })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/tenants/${String(created.body.id)}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/tenants?isActive=false')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const items = response.body.items as { slug: string; isActive: boolean }[];
      expect(items.every((t) => !t.isActive)).toBe(true);
      expect(items.map((t) => t.slug)).toContain('to-suspend');
    });
  });

  describe('jobs monitoring (переїхало з tenant-api — гейт MT-3)', () => {
    it('lists jobs (пусто або дані — pgboss може бути відсутній у тест-БД)', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/jobs?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    });

    it('serves queue stats', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/jobs/queues')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(response.body.queues)).toBe(true);
    });
  });

  // AUTH-2 (T072): дзеркало tenant-плану — сесія-пристрій, cookie, throttler
  describe('AUTH-2: refresh cookie', () => {
    const findSetCookie = (response: { headers: Record<string, unknown> }): string => {
      const raw = response.headers['set-cookie'];
      const cookies = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
      const cookie = cookies.find((c) => c.startsWith('saas_platform_refresh='));
      if (!cookie) {
        throw new Error('saas_platform_refresh cookie not found');
      }
      return cookie;
    };
    const cookieValueOf = (response: { headers: Record<string, unknown> }): string =>
      findSetCookie(response).split(';')[0]!;
    const rawTokenOf = (response: { headers: Record<string, unknown> }): string =>
      // Express URL-кодує значення cookie (':' → '%3A') — розкодовуємо до сирого токена
      decodeURIComponent(cookieValueOf(response).slice('saas_platform_refresh='.length));

    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });

    it('sets an HttpOnly cookie scoped to /api/auth; body carries no refreshToken; access lives 15m', async () => {
      const response = await login().expect(200);
      const cookie = findSetCookie(response);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      expect((response.body as { refreshToken?: unknown }).refreshToken).toBeUndefined();

      const payloadBase64 = String(response.body.accessToken).split('.')[1] ?? '';
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString()) as {
        iat: number;
        exp: number;
      };
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('refresh rotates the token keeping the same sid', async () => {
      const login1 = await login().expect(200);
      const sid = rawTokenOf(login1).split(':')[0];

      const refreshed = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookieValueOf(login1))
        .expect(200);

      expect(refreshed.body.accessToken).toMatch(/^eyJ/);
      const rotatedSid = rawTokenOf(refreshed).split(':')[0];
      expect(rotatedSid).toBe(sid);
      expect(rawTokenOf(refreshed)).not.toBe(rawTokenOf(login1));
    });

    it('reuse outside the rotation window → 401', async () => {
      const login1 = await login().expect(200);
      const cookie1 = cookieValueOf(login1);
      const sid = rawTokenOf(login1).split(':')[0]!;

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie1)
        .expect(200);

      await prisma.platformAuthSession.update({
        where: { id: sid },
        data: { prevRotatedAt: new Date(Date.now() - 2 * 60 * 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie1)
        .expect(401);
    });

    it('logout clears the cookie and revokes the session', async () => {
      const login1 = await login().expect(200);
      const cookie1 = cookieValueOf(login1);
      const sid = rawTokenOf(login1).split(':')[0]!;

      const logout = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie1)
        .expect(204);

      const cleared = findSetCookie(logout);
      expect(cleared).toMatch(/Max-Age=0/);
      expect(cleared).toMatch(/Path=\/api\/auth/);

      const session = await prisma.platformAuthSession.findUnique({ where: { id: sid } });
      expect(session?.revokedReason).toBe('logout');
    });

    it('rejects a foreign Origin on refresh/logout with 403; missing Origin passes', async () => {
      const login1 = await login().expect(200);
      const cookie1 = cookieValueOf(login1);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie1)
        .set('Origin', 'https://evil.example')
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie1)
        .set('Origin', 'https://evil.example')
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie1)
        .expect(200);
    });
  });

  // Бойові пороги — окремий застосунок зі своїм REALTIME_KEY_PREFIX (setup-env.ts
  // піднімає їх глобально, щоб сотні інших тестів не ловили 429; той самий патерн,
  // що apps/api/test/rate-limit.e2e-spec.ts)
  describe('AUTH-2: throttler (production thresholds)', () => {
    let throttledApp: INestApplication;
    let throttledPrisma: SystemPrismaService;
    let redis: Redis;
    let restoreEnv: () => void;
    let keyPattern: string;

    function withEnv(overrides: Record<string, string>): () => void {
      const previous = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
      Object.assign(process.env, overrides);
      return () => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      };
    }

    async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
      const found: string[] = [];
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        found.push(...keys);
      } while (cursor !== '0');
      return found;
    }

    beforeAll(async () => {
      const prefix = `${process.env.REALTIME_KEY_PREFIX ?? 'saas:rt:test'}:platform-ratelimit`;
      restoreEnv = withEnv({
        AUTH_LOGIN_LIMIT_PER_MINUTE: '5',
        AUTH_LOGIN_IP_LIMIT_PER_MINUTE: '20',
        AUTH_REFRESH_LIMIT_PER_MINUTE: '30',
        REALTIME_KEY_PREFIX: prefix,
      });
      keyPattern = `${prefix}:platform:throttle:*`;

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      throttledApp = moduleRef.createNestApplication();
      configureApp(throttledApp);
      await throttledApp.init();
      throttledPrisma = throttledApp.get(SystemPrismaService);
      redis = throttledApp.get<Redis>(REDIS_THROTTLER_CLIENT);

      await throttledPrisma.platformUser.deleteMany();
      await throttledPrisma.platformUser.create({
        data: {
          email: OPERATOR_EMAIL,
          name: 'Operator',
          passwordHash: await argon2.hash(OPERATOR_PASSWORD),
        },
      });
    });

    afterEach(async () => {
      // Кожен тест зі свого «чистого» лічильника — інакше 5/хв «login» з першого
      // тесту з'їдав би спроби другого (та сама причина, що в rate-limit.e2e-spec.ts)
      const keys = await scanKeys(redis, keyPattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await throttledPrisma.platformAuthSession.deleteMany();
    });

    afterAll(async () => {
      await throttledApp.close();
      restoreEnv();
    });

    it('6th login attempt from the same email+ip → 429', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await request(throttledApp.getHttpServer())
          .post('/api/auth/login')
          .send({ email: OPERATOR_EMAIL, password: 'WrongPass123' })
          .expect(401);
      }
      await request(throttledApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
        .expect(429);
    });

    it('31st refresh in a minute from one ip → 429', async () => {
      const login1 = await request(throttledApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
        .expect(200);
      const raw = login1.headers['set-cookie'] as string[] | string;
      const cookies = Array.isArray(raw) ? raw : [raw];
      const cookie = cookies
        .find((c) => c.startsWith('saas_platform_refresh='))!
        .split(';')[0]!;

      for (let attempt = 1; attempt <= 30; attempt++) {
        await request(throttledApp.getHttpServer())
          .post('/api/auth/refresh')
          .set('Cookie', cookie)
          .expect(200);
      }
      await request(throttledApp.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(429);
    });
  });
});
