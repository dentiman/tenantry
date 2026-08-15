/// <reference types="jest" />

// Гейтвей і presence (docs/realtime-internals.md § «Тести»).
// Тести піднімають СПРАВЖНІЙ HTTP-сервер (`app.listen(0)`) і ходять справжнім
// socket.io-клієнтом: підміняти транспорт тут немає сенсу — саме він і є предметом.
// Valkey потрібен живий (як Postgres): Lua-скрипти присутності — не та логіка,
// яку варто перевіряти проти саморобного фейка.

import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import * as argon2 from 'argon2';
import { REALTIME_EVENTS } from '@saas-skeleton/contracts';
import type { PresenceChanged } from '@saas-skeleton/contracts';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Redis } from 'ioredis';
import { REALTIME_CONFIG, REALTIME_REDIS } from '../src/realtime/realtime.constants';
import type { RealtimeConfig } from '../src/realtime/realtime.config';
import { PresenceStore } from '../src/realtime/presence/presence.store';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000042';
const TENANT_B_SLUG = 'rt-tenant-b';

describe('Realtime gateway + presence (e2e)', () => {
  let app: INestApplication;
  let sysPrisma: SystemPrismaService;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Саме listen, а не init: без слухаючого сокета Engine.IO нікуди підключатись
    await app.listen(0);

    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;

    sysPrisma = app.get(SystemPrismaService);
    await sysPrisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: TENANT_B_SLUG, name: 'RT Tenant B' },
    });
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.disconnect();
    }
    // Дати серверу дообробити disconnect: інакше lease наступного тесту
    // накладеться на ще не звільнену попередню
    await sleep(150);
  });

  afterAll(async () => {
    await sysPrisma.user.deleteMany();
    await sysPrisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** Підключення справжнім клієнтом; resolve — тільки після успішного handshake */
  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = ioClient(`${baseUrl}/tenant`, {
        path: '/socket.io',
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
      });
      openSockets.push(socket);
      socket.on('connect', () => {
        resolve(socket);
      });
      socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
        reject(new Error(error.data?.code ?? error.message));
      });
    });

  const snapshot = async (
    accessToken: string,
  ): Promise<{ onlineUserIds: string[]; revision: number }> => {
    const response = await request(app.getHttpServer())
      .get('/api/presence')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return response.body as { onlineUserIds: string[]; revision: number };
  };

  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  describe('handshake', () => {
    it('відхиляє зʼєднання без токена', async () => {
      await expect(connect('')).rejects.toThrow('UNAUTHENTICATED');
    });

    it('відхиляє підроблений токен', async () => {
      await expect(connect('not.a.jwt')).rejects.toThrow('UNAUTHENTICATED');
    });

    it('відхиляє токен, підписаний ЧУЖИМ секретом (межа plane-ів)', async () => {
      const foreign = new JwtService({ secret: 'a-different-secret-that-is-long-enough-32' });
      const token = await foreign.signAsync(
        {
          sub: DEFAULT_TENANT_ID,
          email: 'x@example.com',
          role: 'ADMIN',
          tenantId: DEFAULT_TENANT_ID,
        },
        { expiresIn: '15m' },
      );
      await expect(connect(token)).rejects.toThrow('UNAUTHENTICATED');
    });

    it('відхиляє валідний токен деактивованого юзера', async () => {
      const email = uniqueEmail('rt-inactive');
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email,
        password: 'Password123',
      });
      // Токен ще валідний за підписом — блокування має спрацювати на handshake
      await sysPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await expect(connect(tokens.accessToken)).rejects.toThrow('ACCOUNT_INACTIVE');
    });
  });

  describe('presence', () => {
    it('перша вкладка робить юзера online, друга presence не змінює', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-tabs'),
        password: 'Password123',
      });

      const before = await snapshot(tokens.accessToken);
      expect(before.onlineUserIds).not.toContain(user.id);

      const tab1 = await connect(tokens.accessToken);
      await sleep(200);
      const afterFirst = await snapshot(tokens.accessToken);
      expect(afterFirst.onlineUserIds).toContain(user.id);
      expect(afterFirst.revision).toBe(before.revision + 1);

      await connect(tokens.accessToken);
      await sleep(200);
      const afterSecond = await snapshot(tokens.accessToken);
      // Друга вкладка — той самий online user: ревізія не рухається
      expect(afterSecond.revision).toBe(afterFirst.revision);

      // Закриття ОДНІЄЇ з двох вкладок не робить юзера offline
      tab1.disconnect();
      await sleep(300);
      expect((await snapshot(tokens.accessToken)).onlineUserIds).toContain(user.id);
    });

    it('закриття останньої вкладки дає offline-делту', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-last-tab'),
        password: 'Password123',
      });
      const observerLogin = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-observer'),
        password: 'Password123',
      });

      const observer = await connect(observerLogin.tokens.accessToken);
      const seen: PresenceChanged[] = [];
      observer.on(REALTIME_EVENTS.presenceChanged, (payload: PresenceChanged) => {
        seen.push(payload);
      });

      const socket = await connect(tokens.accessToken);
      await sleep(200);
      socket.disconnect();
      await sleep(300);

      expect(seen).toContainEqual(expect.objectContaining({ userId: user.id, status: 'online' }));
      expect(seen).toContainEqual(expect.objectContaining({ userId: user.id, status: 'offline' }));
      expect((await snapshot(observerLogin.tokens.accessToken)).onlineUserIds).not.toContain(
        user.id,
      );
    });

    it('ревізія росте монотонно і рівно на переходах', async () => {
      const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-revision'),
        password: 'Password123',
      });
      const start = await snapshot(tokens.accessToken);

      const socket = await connect(tokens.accessToken);
      await sleep(200);
      expect((await snapshot(tokens.accessToken)).revision).toBe(start.revision + 1);

      socket.disconnect();
      await sleep(300);
      expect((await snapshot(tokens.accessToken)).revision).toBe(start.revision + 2);
    });
  });

  describe('ізоляція тенантів', () => {
    /** Юзер tenant-а B; логін — через slug (MT-3), як у справжнього клієнта */
    const loginInTenantB = async (): Promise<{ userId: string; accessToken: string }> => {
      const email = uniqueEmail('rt-b');
      const user = await sysPrisma.user.create({
        data: {
          tenantId: TENANT_B_ID,
          email,
          name: 'RT B',
          role: 'USER',
          passwordHash: await argon2.hash('Password123'),
        },
      });
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Password123', tenant: TENANT_B_SLUG })
        .expect(200);
      const body = response.body as { tokens: { accessToken: string } };
      return { userId: user.id, accessToken: body.tokens.accessToken };
    };

    it('snapshot тенанта A не містить юзерів тенанта B', async () => {
      const b = await loginInTenantB();
      await connect(b.accessToken);
      await sleep(200);

      const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-a-admin'),
        password: 'Password123',
        role: 'ADMIN',
      });

      expect((await snapshot(tokens.accessToken)).onlineUserIds).not.toContain(b.userId);
    });

    it('delta тенанта B не доходить до сокета тенанта A', async () => {
      const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-a-watcher'),
        password: 'Password123',
      });
      const watcher = await connect(tokens.accessToken);
      const seen: PresenceChanged[] = [];
      watcher.on(REALTIME_EVENTS.presenceChanged, (payload: PresenceChanged) => {
        seen.push(payload);
      });

      const b = await loginInTenantB();
      await connect(b.accessToken);
      await sleep(300);

      expect(seen.map((p) => p.userId)).not.toContain(b.userId);
    });
  });

  describe('lease expiry', () => {
    /**
     * Протермінування перевіряється НЕ очікуванням 60 секунд, а власним store-ом
     * із мікроскопічним TTL: sweeper ідемпотентний і не залежить від того, хто
     * його викликав, тому це та сама логіка, що ловить `kill -9` ноди.
     */
    it('sweeper знімає юзера, чия lease протермінувалась', async () => {
      const config = app.get<RealtimeConfig>(REALTIME_CONFIG);
      const store = new PresenceStore(app.get<Redis>(REALTIME_REDIS), {
        ...config,
        // Власний префікс — щоб «мертві» ключі цього тесту не бачив живий sweeper застосунку
        keyPrefix: `${config.keyPrefix}:expiry`,
        leaseTtlMs: 50,
      });
      store.onModuleInit();

      const tenantId = DEFAULT_TENANT_ID;
      const userId = '00000000-0000-4000-8000-0000000000aa';
      const deadNode = '00000000-0000-4000-8000-0000000000bb';

      const acquired = await store.acquireLease(tenantId, userId, deadNode);
      expect(acquired.changed).toBe(true);
      expect((await store.readSnapshot(tenantId)).onlineUserIds).toContain(userId);

      // Нода «померла»: leases ніхто не продовжує
      await new Promise((resolve) => setTimeout(resolve, 120));

      const offline = await store.sweepExpired(tenantId);
      expect(offline.map((t) => t.userId)).toContain(userId);
      expect((await store.readSnapshot(tenantId)).onlineUserIds).not.toContain(userId);

      // Повторний прохід нічого не змінює — ось чому лідер не потрібен
      expect(await store.sweepExpired(tenantId)).toHaveLength(0);
    });
  });

  it('створення юзера напряму не робить його online', async () => {
    const user = await createTestUser(sysPrisma, { email: uniqueEmail('rt-plain') });
    const { tokens } = await createAndLoginTestUser(app, sysPrisma, {
      email: uniqueEmail('rt-plain-admin'),
      password: 'Password123',
      role: 'ADMIN',
    });
    expect((await snapshot(tokens.accessToken)).onlineUserIds).not.toContain(user.id);
  });
});
