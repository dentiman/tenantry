/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RealtimeEmitter } from '../src/realtime/realtime.emitter';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

/**
 * Інваріант «у тенанта завжди лишається хоч один активний ADMIN» (UsersService.update/remove/
 * setStatus). Тенант без адміна відновлює лише оператор платформи, тож це не UX-перестраховка.
 */
describe('Users: the last active ADMIN stays (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let counter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, SystemPrismaModule],
    }).compile();
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  interface Admin {
    id: string;
    headers: { Authorization: string };
  }

  const makeUser = async (role: 'ADMIN' | 'USER'): Promise<Admin> => {
    counter += 1;
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `last-admin-${String(counter)}-${String(Date.now())}@example.com`,
      password: 'SecurePass123',
      name: `Last admin ${String(counter)}`,
      role,
    });
    return { id: user.id, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  const activeAdmins = (): Promise<number> =>
    prisma.user.count({ where: { tenantId: DEFAULT_TENANT_ID, role: 'ADMIN', isActive: true } });

  const demote = (actor: Admin, target: Admin): request.Test =>
    request(app.getHttpServer())
      .patch(`/api/users/${target.id}`)
      .set(actor.headers)
      .send({ role: 'USER' });

  const remove = (actor: Admin, target: Admin): request.Test =>
    request(app.getHttpServer()).delete(`/api/users/${target.id}`).set(actor.headers);

  const disable = (actor: Admin, target: Admin): request.Test =>
    request(app.getHttpServer())
      .patch(`/api/users/${target.id}/status`)
      .set(actor.headers)
      .send({ isActive: false });

  describe('the only ADMIN', () => {
    it('cannot demote themselves: 400 last_admin, role untouched', async () => {
      const only = await makeUser('ADMIN');
      const response = await demote(only, only).expect(400);
      expect(response.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'role', code: 'last_admin' }),
      ]);
      expect(await activeAdmins()).toBe(1);
    });

    it('cannot delete themselves: 400 last_admin, row stays', async () => {
      const only = await makeUser('ADMIN');
      const response = await remove(only, only).expect(400);
      expect(response.body.fieldErrors).toEqual([
        expect.objectContaining({ code: 'last_admin' }),
      ]);
      expect(await prisma.user.findUnique({ where: { id: only.id } })).not.toBeNull();
    });

    it('keeps working normally: edits that are not demotion go through', async () => {
      const only = await makeUser('ADMIN');
      await request(app.getHttpServer())
        .patch(`/api/users/${only.id}`)
        .set(only.headers)
        .send({ name: 'Renamed', role: 'ADMIN' })
        .expect(200);
      expect(await activeAdmins()).toBe(1);
    });
  });

  describe('two ADMINs', () => {
    it('one may demote the other, then the remaining one is the last', async () => {
      const a = await makeUser('ADMIN');
      const b = await makeUser('ADMIN');
      await demote(a, b).expect(200);
      expect(await activeAdmins()).toBe(1);
      await demote(a, a).expect(400);
      // Токен `b` ще несе роль ADMIN (JWT живе до 15 хв), але сервер рахує адмінів по БД:
      // вимкнути останнього активного теж не можна
      await disable(b, a).expect(400);
    });

    it('a disabled ADMIN does not count: the active one cannot be demoted', async () => {
      const a = await makeUser('ADMIN');
      const b = await makeUser('ADMIN');
      await prisma.user.update({ where: { id: b.id }, data: { isActive: false } });
      await demote(a, a).expect(400);
    });

    it('concurrent mutual demotion leaves exactly one ADMIN', async () => {
      // Гонка чесна лише статистично: кілька раундів, кожен зі свіжою парою адмінів
      for (let round = 0; round < 6; round += 1) {
        await prisma.authSession.deleteMany();
        await prisma.user.deleteMany();
        const a = await makeUser('ADMIN');
        const b = await makeUser('ADMIN');
        const [first, second] = await Promise.all([demote(a, b), demote(b, a)]);
        expect([first.status, second.status].sort()).toEqual([200, 400]);
        expect(await activeAdmins()).toBe(1);
      }
    });

    it('concurrent mutual delete leaves exactly one ADMIN', async () => {
      for (let round = 0; round < 6; round += 1) {
        await prisma.authSession.deleteMany();
        await prisma.user.deleteMany();
        const a = await makeUser('ADMIN');
        const b = await makeUser('ADMIN');
        const [first, second] = await Promise.all([remove(a, b), remove(b, a)]);
        expect([first.status, second.status].sort()).toEqual([204, 400]);
        expect(await activeAdmins()).toBe(1);
      }
    });

    it('concurrent mutual disable leaves exactly one active ADMIN', async () => {
      for (let round = 0; round < 6; round += 1) {
        await prisma.authSession.deleteMany();
        await prisma.user.deleteMany();
        const a = await makeUser('ADMIN');
        const b = await makeUser('ADMIN');
        const [first, second] = await Promise.all([disable(a, b), disable(b, a)]);
        expect([first.status, second.status].sort()).toEqual([200, 400]);
        expect(await activeAdmins()).toBe(1);
      }
    });
  });

  describe('deleting a user', () => {
    it('writes user.deleted with snapshots and drops the realtime connections', async () => {
      const disconnect = jest.spyOn(app.get(RealtimeEmitter), 'disconnectUser');
      const admin = await makeUser('ADMIN');
      const victim = await makeUser('USER');
      const victimRow = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });

      await remove(admin, victim).expect(204);

      const activity = await prisma.activity.findFirst({
        where: { type: 'user.deleted' },
        include: { links: true },
      });
      expect(activity).toMatchObject({
        actorType: 'user',
        actorId: admin.id,
        payload: { user: { kind: 'user', id: victim.id, label: victimRow.name } },
      });
      expect(activity?.links).toEqual([
        expect.objectContaining({ entityType: 'user', entityId: victim.id, role: 'subject' }),
      ]);
      expect(disconnect).toHaveBeenCalledWith(victim.id);
    });

    it('deleting an unknown id is still 404 and writes nothing', async () => {
      const admin = await makeUser('ADMIN');
      await request(app.getHttpServer())
        .delete('/api/users/00000000-0000-4000-8000-000000000000')
        .set(admin.headers)
        .expect(404);
      expect(await prisma.activity.count({ where: { type: 'user.deleted' } })).toBe(0);
    });
  });
});
