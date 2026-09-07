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
import type {
  CalendarEventChanged,
  NotificationChanged,
  NotificationCreated,
  PresenceChanged,
} from '@saas-skeleton/contracts';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Redis } from 'ioredis';
import { REALTIME_CONFIG, REALTIME_REDIS } from '../src/realtime/realtime.constants';
import type { RealtimeConfig } from '../src/realtime/realtime.config';
import { PresenceStore } from '../src/realtime/presence/presence.store';
import { LastSeenWriter } from '../src/realtime/presence/last-seen.writer';
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

  /**
   * Довговічний `users.last_seen_at` (RT-3). Тести НЕ чекають на періодичний
   * flush (15 с за дефолтом), а кличуть `flushNow()`: детермінізм тут дає явний
   * злив, а не зменшений інтервал — інакше кожна перевірка залежала б від
   * таймінгу таймера.
   */
  describe('last seen', () => {
    const readUser = async (id: string): Promise<{ lastSeenAt: Date | null; updatedAt: Date }> => {
      const row = await sysPrisma.user.findUniqueOrThrow({
        where: { id },
        select: { lastSeenAt: true, updatedAt: true },
      });
      return row;
    };

    it('юзер, який жодного разу не підключався, має lastSeenAt = null', async () => {
      const user = await createTestUser(sysPrisma, { email: uniqueEmail('rt-never') });
      expect((await readUser(user.id)).lastSeenAt).toBeNull();
    });

    it('connect ставить позначку і НЕ рухає updated_at', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-seen-connect'),
        password: 'Password123',
      });
      const before = await readUser(user.id);
      expect(before.lastSeenAt).toBeNull();

      await connect(tokens.accessToken);
      await sleep(150);
      await app.get(LastSeenWriter).flushNow();

      const after = await readUser(user.id);
      expect(after.lastSeenAt).not.toBeNull();
      // Ключова властивість сирого UPDATE-у: присутність — не редагування профілю
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('offline-делта несе той самий час, що записаний у БД', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-seen-delta'),
        password: 'Password123',
      });
      const observerLogin = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-seen-observer'),
        password: 'Password123',
      });
      const observer = await connect(observerLogin.tokens.accessToken);
      const offline: PresenceChanged[] = [];
      observer.on(REALTIME_EVENTS.presenceChanged, (payload: PresenceChanged) => {
        if (payload.status === 'offline' && payload.userId === user.id) {
          offline.push(payload);
        }
      });

      const socket = await connect(tokens.accessToken);
      await sleep(150);
      socket.disconnect();
      await sleep(300);
      await app.get(LastSeenWriter).flushNow();

      expect(offline).toHaveLength(1);
      const [delta] = offline;
      // Без цього поля фронт показав би час фетчу списку, а не час виходу
      expect(delta?.lastSeenAt).toBeDefined();
      expect((await readUser(user.id)).lastSeenAt?.toISOString()).toBe(delta?.lastSeenAt);
    });

    it('позначка не відкочується назад (sweeper пише МИНУЛЕ)', async () => {
      const writer = app.get(LastSeenWriter);
      const user = await createTestUser(sysPrisma, { email: uniqueEmail('rt-seen-monotonic') });

      const fresh = Date.now();
      writer.mark(DEFAULT_TENANT_ID, user.id, fresh);
      await writer.flushNow();
      const applied = (await readUser(user.id)).lastSeenAt;
      expect(applied).not.toBeNull();

      // Саме цей порядок і буває наживо: forgetSocket поставив «щойно», а
      // sweeper через хвилину додає `now − leaseTtl`, тобто більш ранній час
      writer.mark(DEFAULT_TENANT_ID, user.id, fresh - 60_000);
      await writer.flushNow();
      expect((await readUser(user.id)).lastSeenAt?.getTime()).toBe(applied?.getTime());
    });

    it('запис не перетинає межу тенанта (RLS)', async () => {
      const foreign = await sysPrisma.user.create({
        data: { tenantId: TENANT_B_ID, email: uniqueEmail('rt-seen-foreign'), role: 'USER' },
      });
      const writer = app.get(LastSeenWriter);

      // Позначка з КОНТЕКСТОМ тенанта A за юзера тенанта B: політика
      // tenant_isolation має відсікти рядок, а не оновити його
      writer.mark(DEFAULT_TENANT_ID, foreign.id);
      await writer.flushNow();

      expect((await readUser(foreign.id)).lastSeenAt).toBeNull();
    });

    it('GET /api/users віддає lastSeenAt', async () => {
      const { user, tokens } = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-seen-api'),
        password: 'Password123',
        role: 'ADMIN',
      });
      await connect(tokens.accessToken);
      await sleep(150);
      await app.get(LastSeenWriter).flushNow();

      const response = await request(app.getHttpServer())
        .get(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);
      const body = response.body as { lastSeenAt: string | null };
      expect(body.lastSeenAt).toBe((await readUser(user.id)).lastSeenAt?.toISOString());
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

  /**
   * Доставка in-app сповіщень (docs/notifications.md). Перевіряється саме те, чого
   * не видно з HTTP-тестів: емісія йде в ОСОБИСТИЙ room, тобто в усі вкладки
   * отримувача і в жодну чужу, і відбувається вона ПІСЛЯ коміту — подія вже несе
   * лічильники, які збігаються з тим, що віддасть REST.
   */
  describe('доставка сповіщень', () => {
    const waitForNotification = (socket: ClientSocket): Promise<NotificationCreated> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('notification.created.v1 not received'));
        }, 3_000);
        socket.once(REALTIME_EVENTS.notificationCreated, (payload: NotificationCreated) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

    it('доїжджає в усі вкладки отримувача і не доїжджає до автора дії', async () => {
      const observerEmail = uniqueEmail('rt-notify-observer');
      const observer = await createAndLoginTestUser(app, sysPrisma, {
        email: observerEmail,
        password: 'Password123',
        role: 'ADMIN',
      });
      const author = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-notify-author'),
        password: 'Password123',
        role: 'ADMIN',
      });

      // Дві вкладки того самого юзера — обидві мають отримати подію
      const tabA = await connect(observer.tokens.accessToken);
      const tabB = await connect(observer.tokens.accessToken);
      const authorSocket = await connect(author.tokens.accessToken);

      const authorSeen: NotificationCreated[] = [];
      authorSocket.on(REALTIME_EVENTS.notificationCreated, (payload: NotificationCreated) => {
        authorSeen.push(payload);
      });

      const received = Promise.all([waitForNotification(tabA), waitForNotification(tabB)]);

      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${author.tokens.accessToken}`)
        .send({
          email: uniqueEmail('rt-notify-member'),
          password: 'Password123',
          name: 'RT Member',
        })
        .expect(201);

      const [first, second] = await received;
      expect(first.notification.type).toBe('user.created');
      expect(first.unreadCount).toBe(1);
      expect(first.revision).toBeGreaterThan(0);
      expect(second.notification.id).toBe(first.notification.id);

      // Автор дії не отримує сповіщення про власну дію — ні в БД, ні в сокет
      await sleep(200);
      expect(authorSeen).toHaveLength(0);

      // Подія прийшла ПІСЛЯ коміту: REST бачить рівно те саме
      const summaryResponse = await request(app.getHttpServer())
        .get('/api/notifications/summary')
        .set('Authorization', `Bearer ${observer.tokens.accessToken}`)
        .expect(200);
      expect((summaryResponse.body as { revision: number }).revision).toBe(first.revision);

      await sysPrisma.notification.deleteMany();
      await sysPrisma.notificationState.deleteMany();
    });

    it('прочитання в одній вкладці приходить дельтою в іншу', async () => {
      const observer = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-notify-sync'),
        password: 'Password123',
        role: 'ADMIN',
      });
      const notification = await sysPrisma.notification.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          recipientId: observer.user.id,
          type: 'user.welcome',
          actorType: 'system',
          payload: { tenant: 'RT' },
        },
      });

      const tabA = await connect(observer.tokens.accessToken);
      const changed = new Promise<NotificationChanged>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('notification.changed.v1 not received'));
        }, 3_000);
        tabA.once(REALTIME_EVENTS.notificationChanged, (payload: NotificationChanged) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      // Дію робить «інша вкладка» — звичайний HTTP-запит із тим самим токеном
      await request(app.getHttpServer())
        .patch(`/api/notifications/${notification.id}`)
        .set('Authorization', `Bearer ${observer.tokens.accessToken}`)
        .send({ read: true })
        .expect(200);

      const payload = await changed;
      expect(payload.change).toBe('read');
      expect(payload.unreadCount).toBe(0);

      await sysPrisma.notification.deleteMany();
      await sysPrisma.notificationState.deleteMany();
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

  /**
   * Дельти календаря (docs/calendar.md §9.3). Перевіряємо саме те, чого не
   * видно з HTTP: емісія йде в ОСОБИСТІ room-и учасників (не broadcast у
   * tenant-room — інакше факт існування чужої зустрічі з її часом розсилався б
   * усьому тенанту), відбувається ПІСЛЯ коміту, а перенесення дає ДВІ дельти —
   * на нове й на старе вікно.
   */
  describe('дельти календаря', () => {
    const CAL_START = '2027-05-12T10:00:00.000Z';
    const CAL_END = '2027-05-12T11:00:00.000Z';

    const waitForCalendar = (socket: ClientSocket): Promise<CalendarEventChanged> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('calendar.event-changed.v1 not received'));
        }, 3_000);
        socket.once(REALTIME_EVENTS.calendarEventChanged, (payload: CalendarEventChanged) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

    const collect = (socket: ClientSocket): CalendarEventChanged[] => {
      const seen: CalendarEventChanged[] = [];
      socket.on(REALTIME_EVENTS.calendarEventChanged, (payload: CalendarEventChanged) => {
        seen.push(payload);
      });
      return seen;
    };

    it('доїжджає в усі вкладки учасника і НЕ доїжджає до сторонньої людини', async () => {
      const organizer = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-organizer'),
        password: 'Password123',
        role: 'ADMIN',
      });
      const guest = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-guest'),
        password: 'Password123',
      });
      const stranger = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-stranger'),
        password: 'Password123',
      });

      const guestTabA = await connect(guest.tokens.accessToken);
      const guestTabB = await connect(guest.tokens.accessToken);
      const strangerSocket = await connect(stranger.tokens.accessToken);
      const strangerSeen = collect(strangerSocket);

      const received = Promise.all([waitForCalendar(guestTabA), waitForCalendar(guestTabB)]);

      const created = await request(app.getHttpServer())
        .post('/api/calendar/events')
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({
          title: 'RT sync',
          startsAt: CAL_START,
          endsAt: CAL_END,
          attendees: [{ userId: guest.user.id }],
        })
        .expect(201);
      const eventId = (created.body as { id: string }).id;

      const [first, second] = await received;
      expect(first.eventId).toBe(eventId);
      expect(first.change).toBe('created');
      expect(first.startsAt).toBe(CAL_START);
      expect(second.eventId).toBe(eventId);

      await sleep(200);
      // Сторонній не в події — і про її існування не дізнається
      expect(strangerSeen).toHaveLength(0);
    });

    it('на перенесення шле дві дельти: нове вікно і старе', async () => {
      const organizer = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-move'),
        password: 'Password123',
        role: 'ADMIN',
      });

      const created = await request(app.getHttpServer())
        .post('/api/calendar/events')
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({ title: 'RT move', startsAt: CAL_START, endsAt: CAL_END })
        .expect(201);
      const eventId = (created.body as { id: string }).id;

      // Підключаємось ПІСЛЯ створення: цікавить саме дельта переносу
      const socket = await connect(organizer.tokens.accessToken);
      const seen = collect(socket);

      await request(app.getHttpServer())
        .patch(`/api/calendar/events/${eventId}`)
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({ startsAt: '2027-05-20T10:00:00.000Z', endsAt: '2027-05-20T11:00:00.000Z' })
        .expect(200);

      await sleep(300);
      expect(seen).toHaveLength(2);
      // Порядок фіксований: спершу нова межа, потім стара — клієнт інвалідує
      // обидва вікна, тому черговість на результат не впливає, але контракт
      // мусить бути детермінованим
      expect(seen[0]?.startsAt).toBe('2027-05-20T10:00:00.000Z');
      expect(seen[1]?.startsAt).toBe(CAL_START);
      expect(seen.every((delta) => delta.change === 'updated')).toBe(true);
    });

    it('прибраний учасник отримує дельту про зникнення події', async () => {
      const organizer = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-drop-owner'),
        password: 'Password123',
        role: 'ADMIN',
      });
      const guest = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-drop-guest'),
        password: 'Password123',
      });

      const created = await request(app.getHttpServer())
        .post('/api/calendar/events')
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({
          title: 'RT drop',
          startsAt: CAL_START,
          endsAt: CAL_END,
          attendees: [{ userId: guest.user.id }],
        })
        .expect(201);
      const eventId = (created.body as { id: string }).id;

      const guestSocket = await connect(guest.tokens.accessToken);
      const received = waitForCalendar(guestSocket);

      await request(app.getHttpServer())
        .put(`/api/calendar/events/${eventId}/attendees`)
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({ attendees: [{ userId: organizer.user.id }] })
        .expect(200);

      // У room-ах події його вже немає, тому дельта мусить піти в обʼєднання
      // старого і нового складу — інакше подія «залипла» б у його календарі
      const delta = await received;
      expect(delta.eventId).toBe(eventId);
      expect(delta.change).toBe('updated');
    });

    it('не перетікає між тенантами', async () => {
      const organizer = await createAndLoginTestUser(app, sysPrisma, {
        email: uniqueEmail('rt-cal-tenant-a'),
        password: 'Password123',
        role: 'ADMIN',
      });
      const foreignEmail = uniqueEmail('rt-cal-tenant-b');
      await sysPrisma.user.create({
        data: {
          tenantId: TENANT_B_ID,
          email: foreignEmail,
          passwordHash: await argon2.hash('Password123'),
          role: 'ADMIN',
        },
      });
      const foreignTokens = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: foreignEmail, password: 'Password123', tenant: TENANT_B_SLUG })
        .expect(200);
      const foreignSocket = await connect(
        (foreignTokens.body as { tokens: { accessToken: string } }).tokens.accessToken,
      );
      const foreignSeen = collect(foreignSocket);

      await request(app.getHttpServer())
        .post('/api/calendar/events')
        .set('Authorization', `Bearer ${organizer.tokens.accessToken}`)
        .send({ title: 'RT isolation', startsAt: CAL_START, endsAt: CAL_END })
        .expect(201);

      await sleep(250);
      // Room-и мають tenant-префікс, тому однакові id юзерів у різних тенантах
      // не можуть перетнутись (docs/realtime-internals.md § «Room-и»)
      expect(foreignSeen).toHaveLength(0);
    });
  });
});
