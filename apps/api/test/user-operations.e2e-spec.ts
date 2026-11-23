/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import {
  PrismaService,
  SystemPrismaModule,
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import {
  NumberingService,
  StorageService,
  UserOperationRunner,
  UserOperationsService,
} from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ExportCustomersSubscriber } from '../../worker/src/customers/export-customers.subscriber';
import { SweepStalledUserOperationsSubscriber } from '../../worker/src/user-operations/sweep-stalled-user-operations.subscriber';
import { PurgeFinishedUserOperationsSubscriber } from '../../worker/src/user-operations/purge-finished-user-operations.subscriber';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

const TENANT_B_ID = 'tenant-user-ops-b';
const EXPORT_QUEUE = 'customers.export/customers-exporter';

type Headers = Record<string, string>;

interface OperationBody {
  id: string;
  type: string;
  status: string;
  progress: { current: number; total: number } | null;
  revision: number;
  result: Record<string, unknown> | null;
  hasResultFile: boolean;
  errorCode: string | null;
  cancelRequested: boolean;
}

/** In-memory S3: e2e не потребують живого сховища (той самий прийом, що files.e2e-spec) */
class FakeStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  onModuleInit(): Promise<void> {
    return Promise.resolve();
  }
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }
  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
  getDownloadUrl(key: string, options: { filename?: string } = {}): Promise<string> {
    return Promise.resolve(
      `http://storage.test/${encodeURIComponent(key)}?name=${options.filename ?? ''}`,
    );
  }
  text(key: string): string {
    const object = this.objects.get(key);
    // ignoreBOM: true — інакше декодер мовчки зʼїсть BOM, наявність якого тест і перевіряє
    return object ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(object.body) : '';
  }
}

/**
 * Операції користувача й експорт клієнтів (openspec: user-operations/operation, customers/export).
 * Справжній Postgres: інваріанти тримаються на умовних переходах і RLS. Воркерні класи
 * інстанціюються напряму поверх сервісів застосунку — черга в e2e замокана.
 */
describe('User operations (e2e)', () => {
  let app: INestApplication;
  let system: SystemPrismaService;
  let tenantPrisma: PrismaService;
  let tenantContext: TenantContextService;
  let tenantTx: TenantTransactions;
  let operations: UserOperationsService;
  let runner: UserOperationRunner;
  const storage = new FakeStorage();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    system = app.get(SystemPrismaService);
    tenantPrisma = app.get(PrismaService);
    tenantContext = app.get(TenantContextService);
    tenantTx = app.get(TenantTransactions);
    operations = app.get(UserOperationsService);
    runner = app.get(UserOperationRunner);
    await system.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'tenant-user-ops-b', name: 'Tenant User Ops B' },
    });
  });

  beforeEach(async () => {
    sentJobs.reset();
    storage.objects.clear();
    await system.userOperation.deleteMany();
    await system.idempotencyKey.deleteMany();
    await system.customerContact.deleteMany();
    await system.customer.deleteMany();
    await system.numberSequence.deleteMany();
    await system.numberSeries.deleteMany();
    await system.activityLink.deleteMany();
    await system.activity.deleteMany();
    await system.notification.deleteMany();
    await system.notificationState.deleteMany();
    await system.authSession.deleteMany();
    await system.user.deleteMany();
  });

  afterAll(async () => {
    await system.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<{ headers: Headers; id: string }> => {
    const { user, tokens } = await createAndLoginTestUser(app, system, {
      email: `uo-${suffix}@example.com`,
      password: 'SecurePass123',
      name: `UO ${suffix}`,
      role,
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, id: user.id };
  };

  const loginTenantB = async (): Promise<Headers> => {
    await system.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: 'uo-tenant-b@example.com',
        name: 'UO B',
        passwordHash: await argon2.hash('SecurePass123'),
        role: 'ADMIN',
      },
    });
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'uo-tenant-b@example.com', password: 'SecurePass123', tenant: 'tenant-user-ops-b' })
      .expect(200);
    const token = (response.body as { tokens: { accessToken: string } }).tokens.accessToken;
    return { Authorization: `Bearer ${token}` };
  };

  const seedCustomers = async (
    count: number,
    tenantId = DEFAULT_TENANT_ID,
    name = (i: number): string => `Customer ${String(i).padStart(5, '0')}`,
  ): Promise<void> => {
    await system.customer.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        tenantId,
        number: i + 1,
        name: name(i + 1),
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      })),
    });
  };

  const startExport = (
    headers: Headers,
    body: Record<string, unknown> = {},
    key?: string,
  ): request.Test => {
    const call = request(app.getHttpServer()).post('/api/customers/export').set(headers);
    return (key ? call.set('Idempotency-Key', key) : call).send(body);
  };

  const inTenant = <T>(fn: () => Promise<T>, tenantId = DEFAULT_TENANT_ID): Promise<T> =>
    tenantContext.runWith(tenantId, fn);

  const runExport = (operationId: string): Promise<void> => {
    const subscriber = new ExportCustomersSubscriber(
      tenantPrisma,
      runner,
      app.get(NumberingService),
      storage as unknown as StorageService,
      tenantContext,
    );
    return inTenant(() => subscriber.handle({ userOperationId: operationId }));
  };

  const getOperation = async (headers: Headers, id: string): Promise<OperationBody> =>
    (await request(app.getHttpServer()).get(`/api/user-operations/${id}`).set(headers).expect(200))
      .body as OperationBody;

  // ---------------------------------------------------------------- start

  it('starting an export answers 202 with a queued operation and queues one job', async () => {
    const user = await login('start');

    const response = await startExport(user.headers, { status: 'ACTIVE' }).expect(202);
    const body = response.body as OperationBody;

    expect(body).toEqual(
      expect.objectContaining({ type: 'customers.export', status: 'QUEUED', hasResultFile: false }),
    );
    const jobs = sentJobs.forQueue(EXPORT_QUEUE);
    expect(jobs).toHaveLength(1);
    expect((jobs[0]?.envelope as { data: unknown }).data).toEqual({ userOperationId: body.id });
    // Параметри — в операції, а не в job-і
    const row = await system.userOperation.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.params).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(row.userId).toBe(user.id);
  });

  it('the same Idempotency-Key returns the same operation and queues nothing more', async () => {
    const user = await login('idem');
    const key = randomUUID();

    const first = (await startExport(user.headers, {}, key).expect(202)).body as OperationBody;
    const second = await startExport(user.headers, {}, key).expect(202);

    expect((second.body as OperationBody).id).toBe(first.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await system.userOperation.count()).toBe(1);
    expect(sentJobs.forQueue(EXPORT_QUEUE)).toHaveLength(1);
  });

  it('two concurrent starts with one key create one operation', async () => {
    const user = await login('race');
    const key = randomUUID();

    const [a, b] = await Promise.all([
      startExport(user.headers, {}, key),
      startExport(user.headers, {}, key),
    ]);

    expect([a.status, b.status]).toEqual([202, 202]);
    expect((a.body as OperationBody).id).toBe((b.body as OperationBody).id);
    expect(await system.userOperation.count()).toBe(1);
    expect(sentJobs.forQueue(EXPORT_QUEUE)).toHaveLength(1);
  });

  // ------------------------------------------------------------- ownership

  it('only the owner sees an operation: colleague, admin and another tenant get 404', async () => {
    const owner = await login('owner');
    const colleague = await login('colleague');
    const admin = await login('admin', 'ADMIN');
    const tenantB = await loginTenantB();
    const { id } = (await startExport(owner.headers).expect(202)).body as OperationBody;

    for (const headers of [colleague.headers, admin.headers, tenantB]) {
      await request(app.getHttpServer()).get(`/api/user-operations/${id}`).set(headers).expect(404);
      await request(app.getHttpServer())
        .post(`/api/user-operations/${id}/cancel`)
        .set(headers)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/user-operations/${id}/result-url`)
        .set(headers)
        .expect(404);
    }

    const adminList = await request(app.getHttpServer())
      .get('/api/user-operations')
      .set(admin.headers)
      .expect(200);
    expect((adminList.body as { items: unknown[] }).items).toEqual([]);
    // Чуже скасування нічого не змінило
    expect((await getOperation(owner.headers, id)).status).toBe('QUEUED');
  });

  it('lists own operations newest first and can return only active ones', async () => {
    const user = await login('list');
    const first = (await startExport(user.headers).expect(202)).body as OperationBody;
    const second = (await startExport(user.headers).expect(202)).body as OperationBody;
    await request(app.getHttpServer())
      .post(`/api/user-operations/${first.id}/cancel`)
      .set(user.headers)
      .expect(200);

    const all = await request(app.getHttpServer())
      .get('/api/user-operations')
      .set(user.headers)
      .expect(200);
    expect((all.body as { items: OperationBody[] }).items.map((o) => o.id)).toEqual([
      second.id,
      first.id,
    ]);

    const active = await request(app.getHttpServer())
      .get('/api/user-operations?active=true')
      .set(user.headers)
      .expect(200);
    expect((active.body as { items: OperationBody[] }).items.map((o) => o.id)).toEqual([second.id]);
  });

  // ------------------------------------------------------------------ run

  it('a full export writes every matching customer across pages and notifies once', async () => {
    const user = await login('full');
    // 1 203 = три сторінки по 500; плюс архівний, якого фільтр за замовчуванням не бере
    await seedCustomers(1203);
    await system.customer.create({
      data: { tenantId: DEFAULT_TENANT_ID, number: 5000, name: 'Archived Ltd', status: 'ARCHIVED' },
    });
    // Чужий тенант не має потрапити у файл
    await seedCustomers(3, TENANT_B_ID, (i) => `Foreign ${String(i)}`);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;

    await runExport(id);

    const done = await getOperation(user.headers, id);
    expect(done).toEqual(
      expect.objectContaining({
        status: 'SUCCEEDED',
        hasResultFile: true,
        progress: { current: 1203, total: 1203 },
      }),
    );
    expect(done.result).toEqual(
      expect.objectContaining({ rowCount: 1203, filename: expect.stringMatching(/^customers-.*\.csv$/) }),
    );

    const row = await system.userOperation.findUniqueOrThrow({ where: { id } });
    const csv = storage.text(row.resultKey ?? '');
    const lines = csv.split('\r\n').filter((line) => line !== '');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines).toHaveLength(1204);
    expect(lines[0]).toBe(
      '﻿Number,Name,Kind,Status,Email,Phone,Owner email,Tags,Created at (UTC)',
    );
    expect(csv).not.toContain('Archived Ltd');
    expect(csv).not.toContain('Foreign');
    // Ключ обʼєкта — під префіксом тенанта
    expect(row.resultKey?.startsWith(`${DEFAULT_TENANT_ID}/user-operations/${id}/`)).toBe(true);

    expect(
      await system.notification.count({
        where: { recipientId: user.id, type: 'user_operation.succeeded' },
      }),
    ).toBe(1);

    const link = await request(app.getHttpServer())
      .get(`/api/user-operations/${id}/result-url`)
      .set(user.headers)
      .expect(200);
    expect((link.body as { filename: string }).filename).toBe(done.result?.filename);
  });

  it('export applies the grid filters', async () => {
    const user = await login('filtered');
    await seedCustomers(5);
    await system.customer.create({
      data: { tenantId: DEFAULT_TENANT_ID, number: 100, name: '=HYPERLINK("x")', tags: ['vip'] },
    });
    const { id } = (await startExport(user.headers, { tag: 'vip' }).expect(202)).body as OperationBody;

    await runExport(id);

    const row = await system.userOperation.findUniqueOrThrow({ where: { id } });
    const lines = storage.text(row.resultKey ?? '').split('\r\n').filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    // Формула стала текстом
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('a repeated delivery of a finished export does nothing', async () => {
    const user = await login('redeliver');
    await seedCustomers(2);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;
    await runExport(id);
    const before = await system.userOperation.findUniqueOrThrow({ where: { id } });

    await runExport(id);

    const after = await system.userOperation.findUniqueOrThrow({ where: { id } });
    expect(after.revision).toBe(before.revision);
    expect(
      await system.notification.count({ where: { type: 'user_operation.succeeded' } }),
    ).toBe(1);
  });

  // ---------------------------------------------------------------- cancel

  it('cancelling a queued operation ends it at once and the job does nothing', async () => {
    const user = await login('cancel-queued');
    await seedCustomers(2);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;

    const canceled = await request(app.getHttpServer())
      .post(`/api/user-operations/${id}/cancel`)
      .set(user.headers)
      .expect(200);
    expect((canceled.body as OperationBody).status).toBe('CANCELED');

    await runExport(id);

    const row = await system.userOperation.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('CANCELED');
    expect(row.startedAt).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(await system.notification.count({ where: { type: { startsWith: 'user_operation' } } })).toBe(0);
  });

  it('cancelling a running operation stops it at the next checkpoint without a result', async () => {
    const user = await login('cancel-running');
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;

    const outcome = await inTenant(() =>
      runner.run(id, 'customers.export', async (context) => {
        await context.progress(1, 10);
        await request(app.getHttpServer())
          .post(`/api/user-operations/${id}/cancel`)
          .set(user.headers)
          .expect(200);
        await context.checkpoint();
        return { result: { never: true } };
      }),
    );

    expect(outcome).toBe('canceled');
    const done = await getOperation(user.headers, id);
    expect(done).toEqual(
      expect.objectContaining({ status: 'CANCELED', hasResultFile: false, result: null }),
    );
    await request(app.getHttpServer())
      .get(`/api/user-operations/${id}/result-url`)
      .set(user.headers)
      .expect(404);
  });

  it('cancelling a finished operation changes nothing', async () => {
    const user = await login('cancel-finished');
    await seedCustomers(1);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;
    await runExport(id);

    const response = await request(app.getHttpServer())
      .post(`/api/user-operations/${id}/cancel`)
      .set(user.headers)
      .expect(200);

    expect((response.body as OperationBody).status).toBe('SUCCEEDED');
    expect((response.body as OperationBody).cancelRequested).toBe(false);
  });

  // ------------------------------------------------------- immutability

  it('a late writer cannot change a final state', async () => {
    const user = await login('late');
    await seedCustomers(1);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;
    await runExport(id);
    const finished = await system.userOperation.findUniqueOrThrow({ where: { id } });

    const progress = await inTenant(() =>
      operations.writeProgress(id, finished.startedAt ?? new Date(), { current: 0, total: 1 }),
    );
    const failed = await inTenant(() =>
      tenantTx.withTenantTx((tx) => operations.fail(tx, { id, status: 'RUNNING' }, 'STALLED')),
    );

    expect(progress).toBeNull();
    expect(failed).toBeNull();
    const after = await system.userOperation.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('SUCCEEDED');
    expect(after.revision).toBe(finished.revision);
  });

  it('a runner whose operation was taken over stops writing', async () => {
    const user = await login('takeover');
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;

    const outcome = await inTenant(() =>
      runner.run(id, 'customers.export', async (context) => {
        // Інший виконавець перехопив операцію (новий токен захоплення)
        await system.userOperation.update({ where: { id }, data: { startedAt: new Date(0) } });
        await context.progress(5, 10);
        return { result: {} };
      }),
    );

    expect(outcome).toBe('skipped');
    const row = await system.userOperation.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('RUNNING');
    expect(row.progressCurrent).toBeNull();
  });

  it('a retry re-claims a running operation only after it went silent', async () => {
    const user = await login('reclaim');
    await seedCustomers(1);
    const { id } = (await startExport(user.headers).expect(202)).body as OperationBody;
    const fresh = new Date();
    await system.userOperation.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: fresh, heartbeatAt: fresh },
    });

    await runExport(id);
    expect((await system.userOperation.findUniqueOrThrow({ where: { id } })).status).toBe('RUNNING');

    const silent = new Date(Date.now() - 16 * 60 * 1000);
    await system.userOperation.update({ where: { id }, data: { heartbeatAt: silent } });
    await runExport(id);
    expect((await system.userOperation.findUniqueOrThrow({ where: { id } })).status).toBe('SUCCEEDED');
  });

  // ----------------------------------------------------------------- crons

  it('the sweeper fails silent running operations and leaves the rest alone', async () => {
    const user = await login('sweep');
    const make = async (status: 'QUEUED' | 'RUNNING', heartbeatAt: Date | null): Promise<string> =>
      (
        await system.userOperation.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            userId: user.id,
            type: 'customers.export',
            title: 'customers.csv',
            params: {},
            status,
            startedAt: heartbeatAt,
            heartbeatAt,
          },
        })
      ).id;
    const stalled = await make('RUNNING', new Date(Date.now() - 20 * 60 * 1000));
    const alive = await make('RUNNING', new Date());
    const queued = await make('QUEUED', null);

    await new SweepStalledUserOperationsSubscriber(system, tenantContext, tenantTx, operations).handle();

    const status = async (id: string): Promise<string> =>
      (await system.userOperation.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(stalled)).toBe('FAILED');
    expect((await system.userOperation.findUniqueOrThrow({ where: { id: stalled } })).errorCode).toBe(
      'STALLED',
    );
    expect(await status(alive)).toBe('RUNNING');
    expect(await status(queued)).toBe('QUEUED');
    expect(
      await system.notification.count({ where: { recipientId: user.id, type: 'user_operation.failed' } }),
    ).toBe(1);
  });

  it('retention deletes operations finished over 30 days ago with their files', async () => {
    const user = await login('purge');
    const make = async (daysAgo: number, key: string): Promise<string> => {
      await storage.putObject(key, new Uint8Array([1]), 'text/csv');
      return (
        await system.userOperation.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            userId: user.id,
            type: 'customers.export',
            title: 'customers.csv',
            params: {},
            status: 'SUCCEEDED',
            resultKey: key,
            finishedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
          },
        })
      ).id;
    };
    const old = await make(31, 'old.csv');
    const recent = await make(29, 'recent.csv');

    await new PurgeFinishedUserOperationsSubscriber(system, storage as unknown as StorageService).handle();

    expect(await system.userOperation.findUnique({ where: { id: old } })).toBeNull();
    expect(await system.userOperation.findUnique({ where: { id: recent } })).not.toBeNull();
    expect(storage.objects.has('old.csv')).toBe(false);
    expect(storage.objects.has('recent.csv')).toBe(true);
  });

  it('deleting a user deletes their operations', async () => {
    const user = await login('cascade');
    await startExport(user.headers).expect(202);

    await system.authSession.deleteMany({ where: { userId: user.id } });
    await system.user.delete({ where: { id: user.id } });

    expect(await system.userOperation.count()).toBe(0);
  });
});
