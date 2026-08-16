/// <reference types="jest" />

// In-app сповіщення (docs/notifications.md). Перевіряється те, що легко зламати
// непомітно: fan-out на ролі, колапс через частковий унікальний індекс, розділення
// unreadCount/newCount, ізоляція чужого інбокса й after-commit хук у withTenantTx.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { NotificationSummary } from '@saas-skeleton/contracts';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

const TENANT_B_ID = '00000000-0000-4000-8000-000000000003';

interface ListResponse {
  items: {
    id: string;
    type: string;
    groupCount: number;
    readAt: string | null;
    archivedAt: string | null;
  }[];
  nextCursor: string | null;
}

describe('Notifications API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let tenantTx: TenantTransactions;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    tenantTx = app.get(TenantTransactions);
    tenantContext = app.get(TenantContextService);

    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'tenant-notif-b', name: 'Tenant B' },
    });
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.notificationState.deleteMany();
    await prisma.notificationPreference.deleteMany();
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  /** Адмін, який зайшов у систему: він і автор дій, і потенційний отримувач */
  const loginAdmin = async (suffix: string) => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `admin-${suffix}@example.com`,
      password: 'SecurePass123',
      name: `Admin ${suffix}`,
      role: 'ADMIN',
    });
    return { user, headers: { Authorization: `Bearer ${tokens.accessToken}` } };
  };

  const createUserViaApi = async (
    headers: { Authorization: string },
    suffix: string,
  ): Promise<string> => {
    const response = await request(server())
      .post('/api/users')
      .set(headers)
      .send({
        email: `member-${suffix}@example.com`,
        password: 'SecurePass123',
        name: `Member ${suffix}`,
      })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  const list = async (
    headers: { Authorization: string },
    query = '',
  ): Promise<ListResponse> => {
    const response = await request(server())
      .get(`/api/notifications${query}`)
      .set(headers)
      .expect(200);
    return response.body as ListResponse;
  };

  const summary = async (headers: { Authorization: string }): Promise<NotificationSummary> => {
    const response = await request(server())
      .get('/api/notifications/summary')
      .set(headers)
      .expect(200);
    return response.body as NotificationSummary;
  };

  describe('fan-out', () => {
    it('сповіщає інших адмінів і НЕ сповіщає автора дії', async () => {
      const suffix = `${String(Date.now())}-fanout`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);

      await createUserViaApi(author.headers, suffix);

      const observerInbox = await list(observer.headers);
      expect(observerInbox.items).toHaveLength(1);
      expect(observerInbox.items[0]?.type).toBe('user.created');

      // Автор про власну дію не дізнається — правило живе в recorder-і
      const authorInbox = await list(author.headers);
      expect(authorInbox.items).toHaveLength(0);
    });

    it('НЕ сповіщає юзерів без ролі ADMIN', async () => {
      const suffix = `${String(Date.now())}-role`;
      const author = await loginAdmin(`author-${suffix}`);
      const { tokens } = await createAndLoginTestUser(app, prisma, {
        email: `plain-${suffix}@example.com`,
        password: 'SecurePass123',
        role: 'USER',
      });

      await createUserViaApi(author.headers, suffix);

      const inbox = await list({ Authorization: `Bearer ${tokens.accessToken}` });
      expect(inbox.items).toHaveLength(0);
    });

    it('сповіщення про зміну пароля йде ЮЗЕРУ, а не адміну', async () => {
      const suffix = `${String(Date.now())}-pwd`;
      const admin = await loginAdmin(`admin-${suffix}`);
      const targetId = await createUserViaApi(admin.headers, suffix);

      await request(server())
        .post(`/api/users/${targetId}/password`)
        .set(admin.headers)
        .send({ password: 'AnotherPass123' })
        .expect(204);

      const rows = await prisma.notification.findMany({
        where: { type: 'user.password_changed' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipientId).toBe(targetId);
    });
  });

  describe('колапс', () => {
    it('схлопує однотипні події в один непрочитаний рядок', async () => {
      const suffix = `${String(Date.now())}-collapse`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);

      await createUserViaApi(author.headers, `${suffix}-1`);
      await createUserViaApi(author.headers, `${suffix}-2`);
      await createUserViaApi(author.headers, `${suffix}-3`);

      const inbox = await list(observer.headers);
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]?.groupCount).toBe(3);
    });

    it('після прочитання наступна подія починає НОВУ групу', async () => {
      const suffix = `${String(Date.now())}-regroup`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);

      await createUserViaApi(author.headers, `${suffix}-1`);
      const first = await list(observer.headers);
      await request(server())
        .patch(`/api/notifications/${String(first.items[0]?.id)}`)
        .set(observer.headers)
        .send({ read: true })
        .expect(200);

      await createUserViaApi(author.headers, `${suffix}-2`);

      // Саме це гарантує ЧАСТКОВИЙ унікальний індекс: прочитаний рядок виходить
      // з-під унікальності, і наступна подія не доливається в нього
      const inbox = await list(observer.headers);
      expect(inbox.items).toHaveLength(2);
      expect(inbox.items.map((item) => item.groupCount)).toEqual([1, 1]);
    });
  });

  describe('стани і лічильники', () => {
    it('seen гасить newCount, не чіпаючи unreadCount', async () => {
      const suffix = `${String(Date.now())}-seen`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);
      await createUserViaApi(author.headers, suffix);

      const before = await summary(observer.headers);
      expect(before).toMatchObject({ unreadCount: 1, newCount: 1 });

      await request(server()).post('/api/notifications/seen').set(observer.headers).expect(201);

      const after = await summary(observer.headers);
      expect(after.newCount).toBe(0);
      // Непрочитане лишається непрочитаним — бейдж і жирний шрифт це різні речі
      expect(after.unreadCount).toBe(1);
      expect(after.revision).toBeGreaterThan(before.revision);
    });

    it('read → unread → archived і фільтри списку', async () => {
      const suffix = `${String(Date.now())}-states`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);
      await createUserViaApi(author.headers, suffix);
      const id = String((await list(observer.headers)).items[0]?.id);

      const patch = async (body: Record<string, boolean>) =>
        request(server())
          .patch(`/api/notifications/${id}`)
          .set(observer.headers)
          .send(body)
          .expect(200);

      await patch({ read: true });
      expect((await list(observer.headers, '?filter=unread')).items).toHaveLength(0);

      // Повернення в непрочитане обов'язкове: інбокс використовують як todo
      await patch({ read: false });
      expect((await list(observer.headers, '?filter=unread')).items).toHaveLength(1);

      await patch({ archived: true });
      expect((await list(observer.headers, '?filter=all')).items).toHaveLength(0);
      expect((await list(observer.headers, '?filter=archived')).items).toHaveLength(1);
      // Архівоване не має висіти в лічильнику непрочитаних
      expect((await summary(observer.headers)).unreadCount).toBe(0);
    });

    it('mark-all-read повертає свіжий summary', async () => {
      const suffix = `${String(Date.now())}-markall`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);
      await createUserViaApi(author.headers, suffix);

      const response = await request(server())
        .post('/api/notifications/mark-all-read')
        .set(observer.headers)
        .expect(201);
      expect((response.body as NotificationSummary).unreadCount).toBe(0);
    });

    it('курсор віддає сторінки без дублів і без пропусків', async () => {
      const suffix = `${String(Date.now())}-cursor`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);

      // Без groupKey — по рядку на подію (інакше колапс дав би одну групу)
      for (let i = 0; i < 5; i += 1) {
        await prisma.notification.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            recipientId: observer.user.id,
            type: 'user.welcome',
            actorType: 'system',
            payload: { tenant: 'Test' },
            createdAt: new Date(Date.now() - i * 1000),
            updatedAt: new Date(Date.now() - i * 1000),
          },
        });
      }

      const first = await list(observer.headers, '?limit=2');
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await list(
        observer.headers,
        `?limit=2&cursor=${encodeURIComponent(String(first.nextCursor))}`,
      );
      const third = await list(
        observer.headers,
        `?limit=2&cursor=${encodeURIComponent(String(second.nextCursor))}`,
      );

      const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(5);
      expect(third.nextCursor).toBeNull();
      expect(author.headers.Authorization).toBeDefined();
    });

    it('невалідний курсор → 400', async () => {
      const suffix = `${String(Date.now())}-badcursor`;
      const admin = await loginAdmin(suffix);
      await request(server())
        .get('/api/notifications?cursor=not-a-cursor')
        .set(admin.headers)
        .expect(400);
    });
  });

  describe('ізоляція', () => {
    it('чуже сповіщення того ж тенанта → 404, а не 403', async () => {
      const suffix = `${String(Date.now())}-foreign`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);
      const intruder = await loginAdmin(`intruder-${suffix}`);
      await createUserViaApi(author.headers, suffix);

      const id = String((await list(observer.headers)).items[0]?.id);
      // 404, бо існування чужого рядка не підтверджуємо
      await request(server())
        .patch(`/api/notifications/${id}`)
        .set(intruder.headers)
        .send({ read: true })
        .expect(404);
    });

    it('сповіщення tenant-а B не видно з контексту A', async () => {
      const suffix = `${String(Date.now())}-tenant`;
      const admin = await loginAdmin(suffix);
      const foreign = await prisma.user.create({
        data: { tenantId: TENANT_B_ID, email: `b-${suffix}@example.com`, role: 'ADMIN' },
      });
      await prisma.notification.create({
        data: {
          tenantId: TENANT_B_ID,
          recipientId: foreign.id,
          type: 'user.welcome',
          actorType: 'system',
          payload: { tenant: 'Tenant B' },
        },
      });

      expect((await list(admin.headers)).items).toHaveLength(0);
    });
  });

  describe('преференси', () => {
    it('вимкнений тип не створює рядка', async () => {
      const suffix = `${String(Date.now())}-prefs`;
      const author = await loginAdmin(`author-${suffix}`);
      const observer = await loginAdmin(`observer-${suffix}`);

      await request(server())
        .put('/api/notifications/preferences')
        .set(observer.headers)
        .send({ items: [{ type: 'user.created', channel: 'in_app', enabled: false }] })
        .expect(200);

      await createUserViaApi(author.headers, suffix);
      expect((await list(observer.headers)).items).toHaveLength(0);
    });

    it('немутабельний тип не можна вимкнути (400) і він приходить попри спробу', async () => {
      const suffix = `${String(Date.now())}-immutable`;
      const admin = await loginAdmin(`admin-${suffix}`);
      const targetId = await createUserViaApi(admin.headers, suffix);
      const targetTokens = await request(server())
        .post('/api/auth/login')
        .send({ email: `member-${suffix}@example.com`, password: 'SecurePass123' })
        .expect(200);
      const targetHeaders = {
        Authorization: `Bearer ${(targetTokens.body as { tokens: { accessToken: string } }).tokens.accessToken}`,
      };

      await request(server())
        .put('/api/notifications/preferences')
        .set(targetHeaders)
        .send({ items: [{ type: 'user.password_changed', channel: 'in_app', enabled: false }] })
        .expect(400);

      await request(server())
        .post(`/api/users/${targetId}/password`)
        .set(admin.headers)
        .send({ password: 'AnotherPass123' })
        .expect(204);

      const rows = await prisma.notification.findMany({
        where: { recipientId: targetId, type: 'user.password_changed' },
      });
      expect(rows).toHaveLength(1);
    });

    it('преференси віддаються повним списком типів із дефолтами з коду', async () => {
      const suffix = `${String(Date.now())}-preflist`;
      const admin = await loginAdmin(suffix);
      const response = await request(server())
        .get('/api/notifications/preferences')
        .set(admin.headers)
        .expect(200);

      const items = (response.body as { items: { type: string; muteable: boolean }[] }).items;
      expect(items.map((item) => item.type)).toEqual(
        expect.arrayContaining(['user.created', 'user.password_changed', 'user.welcome']),
      );
      expect(items.find((item) => item.type === 'user.password_changed')?.muteable).toBe(false);
    });
  });

  /**
   * Хук after-commit — механізм, на якому тримається вся socket-емісія інбокса.
   * Перевіряється не «чи викликається», а три властивості, від яких залежить
   * коректність: не виконується при відкаті, виконується після коміту, і власне
   * падіння не валить уже закомічену транзакцію.
   */
  describe('after-commit хук (withTenantTx)', () => {
    const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
      tenantContext.runWith(DEFAULT_TENANT_ID, fn);

    it('виконується ПІСЛЯ успішного коміту', async () => {
      const calls: string[] = [];
      await inTenant(async () => {
        await tenantTx.withTenantTx(async (tx) => {
          tenantTx.onCommit(tx, () => {
            calls.push('hook');
          });
          calls.push('tx');
        });
      });
      expect(calls).toEqual(['tx', 'hook']);
    });

    it('НЕ виконується, якщо транзакція відкотилась', async () => {
      let called = false;
      await expect(
        inTenant(async () => {
          await tenantTx.withTenantTx((tx) => {
            tenantTx.onCommit(tx, () => {
              called = true;
            });
            throw new Error('boom');
          });
        }),
      ).rejects.toThrow('boom');
      expect(called).toBe(false);
    });

    it('падіння хука не валить транзакцію', async () => {
      const suffix = `${String(Date.now())}-hookfail`;
      const user = await createTestUser(prisma, { email: `hook-${suffix}@example.com` });

      await inTenant(async () => {
        await tenantTx.withTenantTx(async (tx) => {
          tenantTx.onCommit(tx, () => {
            throw new Error('emit failed');
          });
          await tx.user.update({ where: { id: user.id }, data: { name: 'Committed' } });
        });
      });

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated?.name).toBe('Committed');
    });

    it('onCommit поза транзакцією — помилка викликача', () => {
      expect(() => {
        // Приведення навмисне: перевіряємо саме захист від «tx не звідти»
        tenantTx.onCommit({} as never, () => undefined);
      }).toThrow(/outside withTenantTx/);
    });
  });
});
