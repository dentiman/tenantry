/// <reference types="jest" />

import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Redis } from 'ioredis';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS_THROTTLER_CLIENT } from '../src/redis/redis.constants';
import { createTestUser } from './test-users';

// AUTH-0 (spec US1, FR-001…FR-005): обмеження частоти на вході.
// Окремий файл, а не describe в auth.e2e-spec: сьют піднімає СВІЙ застосунок із бойовими
// порогами (setup-env.ts глобально їх піднімає, щоб сотні інших тестів не ловили 429).

const PASSWORD = 'RateLimitPass123';

/** Бойові пороги зі spec — поверх піднятих у setup-env.ts */
const PRODUCTION_LIMITS = {
  AUTH_LOGIN_LIMIT_PER_MINUTE: '5',
  AUTH_LOGIN_IP_LIMIT_PER_MINUTE: '20',
};

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

/** SCAN повертає сторінку за сторінкою; одна сторінка може бути порожньою навіть за наявних ключів */
async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}

async function deleteKeys(redis: Redis, pattern: string): Promise<void> {
  const keys = await scanKeys(redis, pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

describe('Rate limiting (e2e, AUTH-0)', () => {
  describe('with a working throttler storage', () => {
    let app: INestApplication;
    let prisma: SystemPrismaService;
    let redis: Redis;
    let restoreEnv: () => void;
    let keyPattern: string;

    // Кожен тест — зі свого IP (X-Forwarded-For + trust proxy): лічильник `login-ip`
    // одного тесту не має з'їдати ліміт наступного
    let ipCounter = 0;
    const nextIp = (): string => `203.0.113.${String(++ipCounter)}`;

    const login = (email: string, password: string, ip: string) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password });

    beforeAll(async () => {
      // Свій префікс ключів — щоб прибирання не зачепило лічильники сусідніх сьютів
      const prefix = `${process.env.REALTIME_KEY_PREFIX ?? 'saas:rt:test'}:ratelimit`;
      restoreEnv = withEnv({ ...PRODUCTION_LIMITS, REALTIME_KEY_PREFIX: prefix });
      keyPattern = `${prefix}:throttle:*`;

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
      prisma = app.get(SystemPrismaService);
      redis = app.get<Redis>(REDIS_THROTTLER_CLIENT);
    });

    afterEach(async () => {
      await deleteKeys(redis, keyPattern);
      await prisma.authSession.deleteMany();
      await prisma.user.deleteMany();
    });

    afterAll(async () => {
      await app.close();
      restoreEnv();
    });

    it('rejects the 6th login for the same email and IP — even with the right password', async () => {
      await createTestUser(prisma, { email: 'victim@example.com', password: PASSWORD });
      const ip = nextIp();

      for (let attempt = 1; attempt <= 5; attempt++) {
        await login('victim@example.com', 'WrongPassword123', ip).expect(401);
      }

      // Ліміт не розрізняє успіх і невдачу — інакше атакуючий бачив би, коли вгадав
      const blocked = await login('victim@example.com', PASSWORD, ip).expect(429);

      expect(blocked.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        requestId: expect.any(String),
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // Пакетні лічильники не світимо — вони підказали б, скільки спроб лишилось
      expect(blocked.headers['x-ratelimit-remaining-login']).toBeUndefined();
    });

    it('normalizes the email in the key (case and surrounding spaces)', async () => {
      const ip = nextIp();
      for (let attempt = 1; attempt <= 5; attempt++) {
        await login('  Victim@Example.com ', 'WrongPassword123', ip).expect(401);
      }
      await login('victim@example.com', 'WrongPassword123', ip).expect(429);
    });

    it('does not block another email from the same IP', async () => {
      await createTestUser(prisma, { email: 'colleague@example.com', password: PASSWORD });
      const ip = nextIp();

      for (let attempt = 1; attempt <= 6; attempt++) {
        await login('attacked@example.com', 'WrongPassword123', ip);
      }
      await login('attacked@example.com', 'WrongPassword123', ip).expect(429);

      // Корпоративний NAT: колега за тим самим зовнішнім IP входить далі
      await login('colleague@example.com', PASSWORD, ip).expect(200);
    });

    it('stores the login counter with a TTL of one window, so it resets by itself', async () => {
      await login('ttl@example.com', 'WrongPassword123', nextIp()).expect(401);

      const keys = await scanKeys(redis, keyPattern.replace('*', 'login:*'));
      expect(keys.length).toBeGreaterThan(0);
      const ttls = await Promise.all(keys.map((key) => redis.pttl(key)));
      for (const ttl of ttls) {
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60_000);
      }
    });

    it('caps logins per IP across different emails', async () => {
      const ip = nextIp();
      for (let attempt = 1; attempt <= 20; attempt++) {
        await login(`spray-${String(attempt)}@example.com`, 'WrongPassword123', ip).expect(401);
      }
      await login('spray-21@example.com', 'WrongPassword123', ip).expect(429);

      // Інший IP цим лічильником не зачеплений
      await login('spray-21@example.com', 'WrongPassword123', nextIp()).expect(401);
    });
  });

  describe('general ceiling', () => {
    let app: INestApplication;
    let prisma: SystemPrismaService;
    let redis: Redis;
    let restoreEnv: () => void;
    let keyPattern: string;

    // Низька стеля, щоб перевищити її за кілька запитів; логін лишається розслабленим
    const DEFAULT_LIMIT = 3;
    const OFFICE_IP = '198.51.100.7';

    beforeAll(async () => {
      const prefix = `${process.env.REALTIME_KEY_PREFIX ?? 'saas:rt:test'}:ratelimit-default`;
      restoreEnv = withEnv({
        THROTTLE_DEFAULT_LIMIT_PER_MINUTE: String(DEFAULT_LIMIT),
        REALTIME_KEY_PREFIX: prefix,
      });
      keyPattern = `${prefix}:throttle:*`;

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
      prisma = app.get(SystemPrismaService);
      redis = app.get<Redis>(REDIS_THROTTLER_CLIENT);
    });

    afterEach(async () => {
      await deleteKeys(redis, keyPattern);
      await prisma.authSession.deleteMany();
      await prisma.user.deleteMany();
    });

    afterAll(async () => {
      await app.close();
      restoreEnv();
    });

    /** Логін з окремої адреси — щоб він не з'їдав анонімний лічильник офісного IP */
    async function accessTokenFor(email: string, loginIp: string): Promise<string> {
      await createTestUser(prisma, { email, password: PASSWORD });
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', loginIp)
        .send({ email, password: PASSWORD })
        .expect(200);
      return (response.body as { tokens: { accessToken: string } }).tokens.accessToken;
    }

    const me = (token: string) =>
      request(app.getHttpServer())
        .get('/api/auth/me')
        .set('X-Forwarded-For', OFFICE_IP)
        .set('Authorization', `Bearer ${token}`);

    it('counts authenticated traffic per user, so colleagues behind one NAT do not share it', async () => {
      const alice = await accessTokenFor('alice@example.com', '192.0.2.10');
      const bob = await accessTokenFor('bob@example.com', '192.0.2.11');

      for (let hit = 1; hit <= DEFAULT_LIMIT; hit++) {
        await me(alice).expect(200);
      }
      await me(alice).expect(429);

      // Той самий зовнішній IP, інша людина — власний лічильник
      await me(bob).expect(200);
    });
  });

  describe('when the throttler storage is unavailable (fail-open)', () => {
    let app: INestApplication;
    let prisma: SystemPrismaService;
    let restoreEnv: () => void;
    let warnSpy: jest.SpyInstance;

    const brokenClient = {
      multi: () => {
        const chain = {
          set: () => chain,
          incr: () => chain,
          pttl: () => chain,
          exec: () => Promise.reject(new Error("Stream isn't writeable")),
        };
        return chain;
      },
      quit: () => Promise.resolve('OK'),
      disconnect: () => undefined,
      on: () => undefined,
    };

    beforeAll(async () => {
      restoreEnv = withEnv(PRODUCTION_LIMITS);
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(REDIS_THROTTLER_CLIENT)
        .useValue(brokenClient)
        .compile();
      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
      prisma = app.get(SystemPrismaService);
    });

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn');
    });

    afterEach(async () => {
      warnSpy.mockRestore();
      await prisma.authSession.deleteMany();
      await prisma.user.deleteMany();
    });

    afterAll(async () => {
      await app.close();
      restoreEnv();
    });

    it('lets logins through instead of failing, and logs every skipped check', async () => {
      await createTestUser(prisma, { email: 'open@example.com', password: PASSWORD });

      for (let attempt = 1; attempt <= 7; attempt++) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'open@example.com', password: 'WrongPassword123' })
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'open@example.com', password: PASSWORD })
        .expect(200);

      const skipped = warnSpy.mock.calls.filter(
        ([payload]) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { event?: string }).event === 'throttler_storage_unavailable',
      );
      expect(skipped.length).toBeGreaterThan(0);
    });
  });
});
