/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import { ActivityRecorder } from '@saas-skeleton/shared';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

describe('Activities API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
