/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import { ActivityRecorder } from '@saas-skeleton/shared';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

describe('Activities API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const adminHeaders = async (
    suffix: string,
  ): Promise<{ headers: { Authorization: string }; email: string }> => {
    const email = `admin-${suffix}@example.com`;
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: `Admin ${suffix}`,
      // Створення юзера — ADMIN-only (`@Roles` на мутаціях `/users`)
      role: 'ADMIN',
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, email };
  };

  /**
   * Пряме сідування активності (для курсорних сценаріїв) — під BYPASSRLS, явний
   * tenantId. Активність і лінк створюються окремими unchecked-викликами: змішати
   * скалярний tenantId з вкладеним links.create не можна (nested write → checked
   * input, де скаляр недоступний).
   */
  const seedActivity = async (entityId: string, createdAt: Date): Promise<string> => {
    const activity = await prisma.activity.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        type: 'user.created',
        actorType: 'system',
        payload: { user: { kind: 'user', id: entityId, label: 'Seed User' } },
        createdAt,
      },
    });
    await prisma.activityLink.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        activityId: activity.id,
        entityType: 'user',
        entityId,
        role: 'subject',
      },
    });
    return activity.id;
  };

  it('records exactly one user.created activity when creating a user', async () => {
    const { headers, email: adminEmail } = await adminHeaders(`${Date.now()}-create`);

    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({
        email: `new-${Date.now()}@example.com`,
        name: 'Ivan Petrenko',
        role: 'USER',
        password: 'InitialPass123',
      })
      .expect(201);

    const userId = created.body.id as string;

    const activities = await prisma.activity.findMany({
      where: { type: 'user.created', links: { some: { entityType: 'user', entityId: userId } } },
      include: { links: true },
    });

    expect(activities).toHaveLength(1);
    const [activity] = activities;
    // Явне звуження: під noUncheckedIndexedAccess доступ за індексом дає `| undefined`,
    // а toHaveLength вище для TS нічого не доводить
    if (!activity) throw new Error('Expected a recorded user.created activity');
    expect(activity.actorType).toBe('user');
    expect(activity.actorLabel).toBe(adminEmail);
    expect(activity.actorId).toEqual(expect.any(String));
    expect(activity.payload).toEqual({
      user: { kind: 'user', id: userId, label: 'Ivan Petrenko' },
    });
    expect(activity.links).toEqual([
      expect.objectContaining({ entityType: 'user', entityId: userId, role: 'subject' }),
    ]);
  });

  it('returns the feed for an entity and not for others', async () => {
    const { headers } = await adminHeaders(`${Date.now()}-feed`);
    const target = await createTestUser(prisma, { email: `t-${Date.now()}@example.com` });
    const other = await createTestUser(prisma, { email: `o-${Date.now()}@example.com` });
    await seedActivity(target.id, new Date());

    const feed = await request(app.getHttpServer())
      .get('/api/activities')
      .set(headers)
      .query({ entityType: 'user', entityId: target.id })
      .expect(200);

    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0].type).toBe('user.created');
    expect(feed.body.nextCursor).toBeNull();

    const otherFeed = await request(app.getHttpServer())
      .get('/api/activities')
      .set(headers)
      .query({ entityType: 'user', entityId: other.id })
      .expect(200);
    expect(otherFeed.body.items).toHaveLength(0);
  });

  it('filters the feed by type', async () => {
    const { headers } = await adminHeaders(`${Date.now()}-type`);
    const target = await createTestUser(prisma, { email: `ty-${Date.now()}@example.com` });
    await seedActivity(target.id, new Date());

    const match = await request(app.getHttpServer())
      .get('/api/activities')
      .set(headers)
      .query({ entityType: 'user', entityId: target.id, type: 'user.created' })
      .expect(200);
    expect(match.body.items).toHaveLength(1);

    const noMatch = await request(app.getHttpServer())
      .get('/api/activities')
      .set(headers)
      .query({ entityType: 'user', entityId: target.id, type: 'email.sent' })
      .expect(200);
    expect(noMatch.body.items).toHaveLength(0);
  });

  it('paginates by cursor without duplicates or gaps', async () => {
    const { headers } = await adminHeaders(`${Date.now()}-cursor`);
    const target = await createTestUser(prisma, { email: `c-${Date.now()}@example.com` });

    const base = Date.now();
    const seeded: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Зростальні createdAt → детермінований порядок (найновіші перші у фіді)
      seeded.push(await seedActivity(target.id, new Date(base + i * 1000)));
    }
    const expectedDesc = [...seeded].reverse();

    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get('/api/activities')
        .set(headers)
        .query({ entityType: 'user', entityId: target.id, limit: 2, ...(cursor && { cursor }) })
        .expect(200);
      collected.push(...res.body.items.map((a: { id: string }) => a.id));
      pages += 1;
      if (!res.body.nextCursor) {
        break;
      }
      cursor = res.body.nextCursor as string;
      expect(pages).toBeLessThan(10); // страховка від нескінченного циклу
    }

    expect(pages).toBe(3); // 5 елементів по 2 = 2 + 2 + 1
    expect(collected).toEqual(expectedDesc); // порядок, без дублів і пропусків
  });

  describe('workspace feed (GET /activities/workspace)', () => {
    /**
     * Сідування з довільним типом/тенантом: загальна стрічка фільтрує за ТИПОМ, тож для неї важить
     * саме тип. Payload мінімальний — recorder тут обходимо (fail-fast-перевірку payload-у
     * має окремий юніт нижче), а фільтр на payload не дивиться.
     */
    const seedTyped = async (
      type: string,
      createdAt: Date,
      tenantId: string = DEFAULT_TENANT_ID,
    ): Promise<string> => {
      const activity = await prisma.activity.create({
        data: { tenantId, type, actorType: 'system', payload: {}, createdAt },
      });
      return activity.id;
    };

    const userHeaders = async (
      suffix: string,
    ): Promise<{ Authorization: string }> => {
      const { tokens } = await createAndLoginTestUser(app, prisma, {
        email: `member-${suffix}@example.com`,
        password: 'SecurePass123',
        name: `Member ${suffix}`,
        role: 'USER',
      });
      return { Authorization: `Bearer ${tokens.accessToken}` };
    };

    it('lists only types their owner allowed for everyone, newest first, to a plain USER', async () => {
      const headers = await userHeaders(`${Date.now()}-ws`);
      const base = Date.now();

      const visibleOld = await seedTyped('customer.created', new Date(base - 3000));
      const visibleNew = await seedTyped('user.created', new Date(base - 1000));
      // Типи, яких загальна стрічка показувати не має: безпека, налаштування, лист, і календар —
      // подія не знає, приватна вона чи ні (доступ до запису тут недоступний)
      await seedTyped('user.password_changed', new Date(base - 500));
      await seedTyped('user.sessions_revoked', new Date(base - 400));
      await seedTyped('settings.updated', new Date(base - 300));
      await seedTyped('email.sent', new Date(base - 200));
      await seedTyped('calendar_event.created', new Date(base - 100));

      const res = await request(app.getHttpServer())
        .get('/api/activities/workspace')
        .set(headers)
        .expect(200);

      expect((res.body.items as { id: string }[]).map((item) => item.id)).toEqual([
        visibleNew,
        visibleOld,
      ]);
      expect(res.body.nextCursor).toBeNull();
    });

    it("never returns another tenant's activity", async () => {
      const headers = await userHeaders(`${Date.now()}-ws-rls`);
      const otherId = `ws-other-${Date.now()}`;
      await prisma.tenant.create({ data: { id: otherId, slug: otherId, name: otherId } });
      try {
        await seedTyped('customer.created', new Date(), otherId);
        const mine = await seedTyped('customer.created', new Date(Date.now() - 1000));

        const res = await request(app.getHttpServer())
          .get('/api/activities/workspace')
          .set(headers)
          .expect(200);

        expect((res.body.items as { id: string }[]).map((item) => item.id)).toEqual([mine]);
      } finally {
        await prisma.activity.deleteMany({ where: { tenantId: otherId } });
        await prisma.tenant.delete({ where: { id: otherId } });
      }
    });

    it('paginates by cursor and hidden types never eat a page slot', async () => {
      const headers = await userHeaders(`${Date.now()}-ws-cursor`);
      const base = Date.now();

      const seeded: string[] = [];
      for (let i = 0; i < 5; i++) {
        seeded.push(await seedTyped('customer.created', new Date(base + i * 1000)));
        // Прихована подія між видимими: фільтр має бути в запиті, а не після вибірки сторінки,
        // інакше сторінки виходили б неповними, а курсор — з пропусками
        await seedTyped('user.password_changed', new Date(base + i * 1000 + 500));
      }

      const collected: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const res = await request(app.getHttpServer())
          .get('/api/activities/workspace')
          .set(headers)
          .query({ limit: 2, ...(cursor && { cursor }) })
          .expect(200);
        collected.push(...(res.body.items as { id: string }[]).map((item) => item.id));
        pages += 1;
        if (!res.body.nextCursor) {
          break;
        }
        cursor = res.body.nextCursor as string;
        expect(pages).toBeLessThan(10);
      }

      expect(pages).toBe(3);
      expect(collected).toEqual([...seeded].reverse());
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/activities/workspace').expect(401);
    });
  });

  it('rejects an invalid cursor with 400', async () => {
    const { headers } = await adminHeaders(`${Date.now()}-badcursor`);
    const target = await createTestUser(prisma, { email: `bc-${Date.now()}@example.com` });

    await request(app.getHttpServer())
      .get('/api/activities')
      .set(headers)
      .query({ entityType: 'user', entityId: target.id, cursor: 'not-a-valid-cursor' })
      .expect(400);
  });
});

describe('ActivityRecorder (unit)', () => {
  it('throws (fail fast) on a payload that does not match the type schema', async () => {
    const recorder = new ActivityRecorder();
    const tx = {
      activity: { create: jest.fn() },
      activityLink: { createMany: jest.fn() },
    };

    await expect(
      recorder.record(tx as unknown as Prisma.TransactionClient, {
        type: 'user.created',
        actor: { type: 'system' },
        payload: { wrong: 'shape' }, // бракує user: EntityRef
        links: [],
      }),
    ).rejects.toThrow();

    // Невалідний payload не має долетіти до вставки в append-only таблицю
    expect(tx.activity.create).not.toHaveBeenCalled();
  });
});
