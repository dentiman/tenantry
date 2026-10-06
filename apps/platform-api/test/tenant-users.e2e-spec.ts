/// <reference types="jest" />

// Control plane: аварійне керування юзерами tenant-а. Інваріанти: скоуп по tenant-у,
// пароль міняється разом із відкликанням сесій, слід у двох журналах (activity з актором
// system у tenant-і + platform_audit_events), чужий юзер = 404.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';

const OPERATOR_EMAIL = 'operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';
const NEW_PASSWORD = 'BrandNewPassword123';

describe('Platform tenant users (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let token: string;
  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let userB: string;

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
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    token = String(login.body.accessToken);

    const passwordHash = await argon2.hash('OldPassword12345');
    const a = await prisma.tenant.create({ data: { slug: 'tu-a', name: 'A' } });
    const b = await prisma.tenant.create({ data: { slug: 'tu-b', name: 'B' } });
    tenantA = a.id;
    tenantB = b.id;
    adminA = (
      await prisma.user.create({
        data: {
          tenantId: a.id,
          email: 'admin@a.test',
          name: 'Admin A',
          passwordHash,
          role: 'ADMIN',
        },
      })
    ).id;
    userB = (
      await prisma.user.create({
        data: { tenantId: b.id, email: 'user@b.test', passwordHash, role: 'USER' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
  const url = (tenantId: string, rest = ''): string => `/api/tenants/${tenantId}/users${rest}`;

  const createSession = (userId: string, tenantId: string): Promise<{ id: string }> =>
    prisma.authSession.create({
      data: {
        userId,
        tenantId,
        tokenHash: 'sha256:test',
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 7_200_000),
      },
    });

  it('requires an operator token', async () => {
    await request(app.getHttpServer()).get(url(tenantA)).expect(401);
    await request(app.getHttpServer())
      .post(url(tenantA, `/${adminA}/password`))
      .send({ password: NEW_PASSWORD })
      .expect(401);
  });

  it('lists only the users of the requested tenant, without sensitive fields', async () => {
    const res = await auth(request(app.getHttpServer()).get(url(tenantA))).expect(200);
    expect(res.body.items.map((u: { email: string }) => u.email)).toEqual(['admin@a.test']);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].passwordHash).toBeUndefined();
    expect(res.body.items[0].phone).toBeUndefined();
  });

  it('returns 404 for an unknown tenant', async () => {
    await auth(
      request(app.getHttpServer()).get(url('00000000-0000-4000-8000-000000000099')),
    ).expect(404);
  });

  describe('set password', () => {
    it('changes the hash, revokes sessions and leaves both trails', async () => {
      await createSession(adminA, tenantA);
      await auth(request(app.getHttpServer()).post(url(tenantA, `/${adminA}/password`)))
        .send({ password: NEW_PASSWORD })
        .expect(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: adminA } });
      expect(await argon2.verify(user.passwordHash ?? '', NEW_PASSWORD)).toBe(true);

      const sessions = await prisma.authSession.findMany({ where: { userId: adminA } });
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
      expect(sessions[0]?.revokedReason).toBe('password_change');

      const activity = await prisma.activity.findFirstOrThrow({
        where: { tenantId: tenantA, type: 'user.password_changed' },
      });
      expect(activity.actorType).toBe('system');
      expect(JSON.stringify(activity.payload)).not.toContain(NEW_PASSWORD);
      const link = await prisma.activityLink.findFirstOrThrow({
        where: { activityId: activity.id },
      });
      expect(link).toMatchObject({ tenantId: tenantA, entityType: 'user', entityId: adminA });

      const audit = await prisma.platformAuditEvent.findFirstOrThrow({
        where: { tenantId: tenantA },
      });
      expect(audit).toMatchObject({
        action: 'tenant_user.password_set',
        targetId: adminA,
        actorLabel: OPERATOR_EMAIL,
      });
      expect(JSON.stringify(audit.details)).not.toContain(NEW_PASSWORD);
    });

    it('404 for a user of another tenant, and nothing changes', async () => {
      await auth(request(app.getHttpServer()).post(url(tenantA, `/${userB}/password`)))
        .send({ password: NEW_PASSWORD })
        .expect(404);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userB } });
      expect(await argon2.verify(user.passwordHash ?? '', 'OldPassword12345')).toBe(true);
      expect(await prisma.platformAuditEvent.count()).toBe(0);
    });

    it('400 for a short password', async () => {
      await auth(request(app.getHttpServer()).post(url(tenantA, `/${adminA}/password`)))
        .send({ password: 'short' })
        .expect(400);
    });
  });

  describe('status', () => {
    it('disables: revokes sessions, records activity; repeat is a no-op without a trail', async () => {
      await createSession(adminA, tenantA);
      const patch = (): request.Test =>
        auth(request(app.getHttpServer()).patch(url(tenantA, `/${adminA}/status`))).send({
          isActive: false,
        });

      const first = await patch().expect(200);
      expect(first.body.isActive).toBe(false);
      await patch().expect(200);

      const sessions = await prisma.authSession.findMany({ where: { userId: adminA } });
      expect(sessions[0]?.revokedReason).toBe('user_disabled');
      expect(
        await prisma.activity.count({ where: { tenantId: tenantA, type: 'user.disabled' } }),
      ).toBe(1);
      expect(
        await prisma.platformAuditEvent.count({ where: { action: 'tenant_user.disabled' } }),
      ).toBe(1);
    });

    it('concurrent identical requests leave exactly one trail', async () => {
      await Promise.all(
        [0, 1].map(() =>
          auth(request(app.getHttpServer()).patch(url(tenantA, `/${adminA}/status`)))
            .send({ isActive: false })
            .expect(200),
        ),
      );
      expect(
        await prisma.activity.count({ where: { tenantId: tenantA, type: 'user.disabled' } }),
      ).toBe(1);
    });

    it('re-enables and records user.enabled', async () => {
      await prisma.user.update({ where: { id: adminA }, data: { isActive: false } });
      await auth(request(app.getHttpServer()).patch(url(tenantA, `/${adminA}/status`)))
        .send({ isActive: true })
        .expect(200);
      expect(
        await prisma.activity.count({ where: { tenantId: tenantA, type: 'user.enabled' } }),
      ).toBe(1);
    });

    it('404 for a user of another tenant', async () => {
      await auth(request(app.getHttpServer()).patch(url(tenantA, `/${userB}/status`)))
        .send({ isActive: false })
        .expect(404);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userB } })).isActive).toBe(true);
    });
  });

  describe('revoke sessions', () => {
    it('revokes all live sessions and reports the count', async () => {
      await createSession(adminA, tenantA);
      await createSession(adminA, tenantA);
      const res = await auth(
        request(app.getHttpServer()).post(url(tenantA, `/${adminA}/sessions/revoke`)),
      ).expect(200);
      expect(res.body.revokedCount).toBe(2);
      const activity = await prisma.activity.findFirstOrThrow({
        where: { tenantId: tenantA, type: 'user.sessions_revoked' },
      });
      expect(activity.payload).toMatchObject({ sessionCount: 2, reason: 'revoke_all' });
    });
  });
});
