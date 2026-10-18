/// <reference types="jest" />

// Control plane: стрічка подій усього тенанта. Інваріанти: system-клієнт обходить RLS, тому
// межу тримає лише `tenantId` у запиті — подій чужого тенанта у відповіді немає; оператор
// бачить УСІ типи, а не лише `WORKSPACE_ACTIVITY_TYPES`; курсор той самий, що в tenant-api
// (без дублів і пропусків); невідомий тенант = 404.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { WORKSPACE_ACTIVITY_TYPES } from '@saas-skeleton/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';

const OPERATOR_EMAIL = 'operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';

describe('Platform tenant activities (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let token: string;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.platformUser.deleteMany();
    await prisma.platformAuditEvent.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { not: 'default' } } });
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'Operator',
        passwordHash: await argon2.hash(OPERATOR_PASSWORD),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    token = String(login.body.accessToken);

    tenantA = (await prisma.tenant.create({ data: { slug: 'ta-a', name: 'A' } })).id;
    tenantB = (await prisma.tenant.create({ data: { slug: 'ta-b', name: 'B' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
  const url = (tenantId: string): string => `/api/tenants/${tenantId}/activities`;

  /** Події пишуться напряму: читання не залежить від того, хто і як їх записав */
  const seed = async (tenantId: string, type: string, count: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = await prisma.activity.create({
        data: {
          tenantId,
          type,
          actorType: 'system',
          payload: {},
          // Однакові моменти навмисно: курсор мусить розвʼязувати нічию по id
          createdAt: new Date('2026-10-18T10:00:00.000Z'),
        },
      });
      ids.push(row.id);
    }
    return ids;
  };

  it('requires an operator token', async () => {
    await request(app.getHttpServer()).get(url(tenantA)).expect(401);
  });

  it('returns 404 for an unknown tenant', async () => {
    await auth(
      request(app.getHttpServer()).get(url('00000000-0000-4000-8000-000000000099')),
    ).expect(404);
  });

  it('lists only the events of the requested tenant', async () => {
    const own = await seed(tenantA, 'user.created', 2);
    await seed(tenantB, 'user.created', 3);

    const res = await auth(request(app.getHttpServer()).get(url(tenantA))).expect(200);
    expect(res.body.items.map((a: { id: string }) => a.id).sort()).toEqual([...own].sort());
    expect(res.body.nextCursor).toBeNull();
  });

  it('includes types hidden from the workspace feed', async () => {
    // Безпекова подія: у загальну стрічку воркспейсу не потрапляє, оператор її бачить
    expect(WORKSPACE_ACTIVITY_TYPES).not.toContain('user.password_changed');
    await seed(tenantA, 'user.password_changed', 1);

    const res = await auth(request(app.getHttpServer()).get(url(tenantA))).expect(200);
    expect(res.body.items.map((a: { type: string }) => a.type)).toEqual(['user.password_changed']);
  });

  it('filters by type', async () => {
    await seed(tenantA, 'user.created', 2);
    const [changed] = await seed(tenantA, 'user.password_changed', 1);

    const res = await auth(
      request(app.getHttpServer()).get(url(tenantA)).query({ type: 'user.password_changed' }),
    ).expect(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual([changed]);
  });

  it('pages with a cursor without duplicates or gaps', async () => {
    const all = await seed(tenantA, 'user.created', 5);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await auth(
        request(app.getHttpServer())
          .get(url(tenantA))
          .query({ limit: 2, ...(cursor && { cursor }) }),
      ).expect(200);
      seen.push(...res.body.items.map((a: { id: string }) => a.id));
      cursor = res.body.nextCursor ?? undefined;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('rejects a malformed cursor', async () => {
    await auth(request(app.getHttpServer()).get(url(tenantA)).query({ cursor: 'garbage' })).expect(
      400,
    );
  });
});
