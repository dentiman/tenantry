/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import { ConflictException, Controller, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  SystemPrismaModule,
  SystemPrismaService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { IdempotencyService, requestFingerprint } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Idempotent } from '../src/common/idempotent.decorator';
import { CleanupProcessedJobsSubscriber } from '../../worker/src/subscribers/cleanup-processed-jobs.subscriber';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

const TENANT_B_ID = 'tenant-idempotency-b';
const KEY_HEADER = 'Idempotency-Key';

interface CustomerBody {
  id: string;
  number: number;
  name: string;
}

interface ErrorBody {
  statusCode: number;
  code: string;
}

type Headers = Record<string, string>;

/**
 * Ендпоінти, яких у застосунку немає й бути не може, — лише для двох властивостей шару:
 *
 * - `unclaimed` — D6 (docs/idempotency.md): `@Idempotent()` без `claim(tx)` у сервісі;
 * - `flaky` — помилка ПІСЛЯ `claim` усередині транзакції: відкат мусить забрати й ключ.
 *   У справжніх сервісах таке дає гонка на унікальному індексі, і в тесті її не відтворити
 *   детерміновано — тут помилку вмикає прапорець.
 */
@Controller('test-idempotency')
class ProbeController {
  static failNext = false;

  constructor(
    private readonly tenantTx: TenantTransactions,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('unclaimed')
  @Idempotent()
  unclaimed(): { ok: true } {
    return { ok: true };
  }

  @Post('flaky')
  @Idempotent()
  async flaky(): Promise<{ ok: true }> {
    return this.tenantTx.withTenantTx(async (tx) => {
      await this.idempotency.claim(tx);
      if (ProbeController.failNext) {
        ProbeController.failNext = false;
        throw new ConflictException('Simulated conflict after the key was claimed');
      }
      return { ok: true as const };
    });
  }
}

/**
 * Idempotency-Key для REST-мутацій (openspec: api/idempotency). Реальний Postgres: інваріант
 * тримається на унікальному індексі й на тому, що ключ комітиться в транзакції ефекту, —
 * мок цього не перевірить.
 */
describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, SystemPrismaModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    await prisma.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, slug: 'tenant-idem-b', name: 'Tenant Idempotency B' },
    });
  });

  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany();
    await prisma.scheduledNotification.deleteMany();
    await prisma.calendarReminder.deleteMany();
    await prisma.calendarEventAttendee.deleteMany();
    await prisma.calendarEvent.deleteMany();
    await prisma.customerContact.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.numberSequence.deleteMany();
    await prisma.numberSeries.deleteMany();
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.notificationState.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: TENANT_B_ID } });
    await app.close();
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER' = 'ADMIN',
  ): Promise<{ headers: Headers; id: string }> => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `idem-${suffix}@example.com`,
      password: 'SecurePass123',
      name: `Idem ${suffix}`,
      role,
    });
    // Логін кладе в інбокс `auth.new_device`; сьют рахує сповіщення про доменні події
    await prisma.notification.deleteMany({ where: { type: 'auth.new_device' } });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, id: user.id };
  };

  const postCustomer = (
    headers: Headers,
    body: Record<string, unknown>,
    key?: string,
  ): request.Test => {
    const call = request(app.getHttpServer()).post('/api/customers').set(headers);
    return (key === undefined ? call : call.set(KEY_HEADER, key)).send(body);
  };

  const customerCount = (tenantId = DEFAULT_TENANT_ID): Promise<number> =>
    prisma.customer.count({ where: { tenantId } });

  // ------------------------------------------------------------------ replay

  it('returns the original response on a repeat and applies the effect once', async () => {
    const admin = await login('replay');
    const key = randomUUID();

    const first = await postCustomer(admin.headers, { name: 'Acme Inc' }, key).expect(201);
    const second = await postCustomer(admin.headers, { name: 'Acme Inc' }, key).expect(201);

    expect(second.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await customerCount()).toBe(1);
    // Повтор не дав другого запису в журналі активності
    expect(await prisma.activity.count({ where: { type: 'customer.created' } })).toBe(1);
    // Номер видано один раз
    const sequence = await prisma.numberSequence.findFirst({ where: { name: 'customer' } });
    expect(sequence?.lastValue).toBe(1);
  });

  it('does not depend on the order of fields in the body', async () => {
    const admin = await login('order');
    const key = randomUUID();

    const first = await postCustomer(admin.headers, { name: 'Acme', tags: ['a'] }, key).expect(201);
    const second = await postCustomer(admin.headers, { tags: ['a'], name: 'Acme' }, key).expect(201);

    expect((second.body as CustomerBody).id).toBe((first.body as CustomerBody).id);
    expect(await customerCount()).toBe(1);
  });

  it('without the header creates a record per request, as before', async () => {
    const admin = await login('nokey');

    const first = await postCustomer(admin.headers, { name: 'Acme Inc' }).expect(201);
    const second = await postCustomer(admin.headers, { name: 'Acme Inc' }).expect(201);

    expect((second.body as CustomerBody).id).not.toBe((first.body as CustomerBody).id);
    expect(await customerCount()).toBe(2);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it('ignores the header on an endpoint that does not support keys', async () => {
    const admin = await login('unsupported');
    const customer = (await postCustomer(admin.headers, { name: 'Acme Inc' }).expect(201))
      .body as CustomerBody;
    const key = randomUUID();
    const addContact = (): request.Test =>
      request(app.getHttpServer())
        .post(`/api/customers/${customer.id}/contacts`)
        .set(admin.headers)
        .set(KEY_HEADER, key)
        .send({ name: 'Jane Roe' });

    await addContact().expect(201);
    await addContact().expect(201);

    expect(await prisma.customerContact.count()).toBe(2);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  // -------------------------------------------------------------- concurrency

  it('two identical concurrent requests create one record and both succeed', async () => {
    const admin = await login('race');
    const key = randomUUID();

    const [first, second] = await Promise.all([
      postCustomer(admin.headers, { name: 'Racy Ltd' }, key),
      postCustomer(admin.headers, { name: 'Racy Ltd' }, key),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as CustomerBody).id).toBe((first.body as CustomerBody).id);
    expect(await customerCount()).toBe(1);
    const sequence = await prisma.numberSequence.findFirst({ where: { name: 'customer' } });
    expect(sequence?.lastValue).toBe(1);
  });

  it('five concurrent duplicates still produce exactly one record', async () => {
    const admin = await login('burst');
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postCustomer(admin.headers, { name: 'Burst Ltd' }, key)),
    );

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => (r.body as CustomerBody).id)).size).toBe(1);
    expect(await customerCount()).toBe(1);
  });

  // ------------------------------------------------------------ key ≠ request

  it('rejects the same key with a different body', async () => {
    const admin = await login('reused');
    const key = randomUUID();
    await postCustomer(admin.headers, { name: 'Acme Inc' }, key).expect(201);

    const response = await postCustomer(admin.headers, { name: 'Other Inc' }, key).expect(422);

    expect((response.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await customerCount()).toBe(1);
  });

  it('rejects a malformed key before doing anything', async () => {
    const admin = await login('malformed');

    await postCustomer(admin.headers, { name: 'Acme Inc' }, 'x'.repeat(256)).expect(400);
    await postCustomer(admin.headers, { name: 'Acme Inc' }, 'two words').expect(400);
    // Межа: 255 символів — ще легальний ключ
    await postCustomer(admin.headers, { name: 'Acme Inc' }, 'x'.repeat(255)).expect(201);

    expect(await customerCount()).toBe(1);
  });

  // ------------------------------------------------- failure leaves no trace

  it('a request rejected before the transaction does not consume its key', async () => {
    const admin = await login('conflict');
    const blocker = (
      await postCustomer(admin.headers, { name: 'Blocker', externalId: 'EXT-1' }).expect(201)
    ).body as CustomerBody;
    const key = randomUUID();
    const body = { name: 'Late Inc', externalId: 'EXT-1' };

    await postCustomer(admin.headers, body, key).expect(400);
    expect(await prisma.idempotencyKey.count()).toBe(0);

    // Причину відмови усунуто — той самий запит з тим самим ключем тепер проходить
    await prisma.customer.delete({ where: { id: blocker.id } });
    const created = await postCustomer(admin.headers, body, key).expect(201);
    const replayed = await postCustomer(admin.headers, body, key).expect(201);

    expect((replayed.body as CustomerBody).id).toBe((created.body as CustomerBody).id);
    expect(await customerCount()).toBe(1);
  });

  it('a failure after the key was claimed rolls the key back with the transaction', async () => {
    const admin = await login('rollback');
    const key = randomUUID();
    const call = (): request.Test =>
      request(app.getHttpServer())
        .post('/api/test-idempotency/flaky')
        .set(admin.headers)
        .set(KEY_HEADER, key);

    ProbeController.failNext = true;
    await call().expect(409);
    // Ключ вставлявся в тій самій транзакції, що впала, — від нього не лишилось нічого
    expect(await prisma.idempotencyKey.count()).toBe(0);

    const applied = await call().expect(201);
    const replayed = await call().expect(201);
    expect(applied.headers['idempotent-replayed']).toBeUndefined();
    expect(replayed.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it('a validation error stores nothing for the key', async () => {
    const admin = await login('invalid');
    const key = randomUUID();

    await postCustomer(admin.headers, {}, key).expect(400);
    await postCustomer(admin.headers, {}, key).expect(400);

    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(await customerCount()).toBe(0);
  });

  // -------------------------------------------------------------------- scope

  it('the same key value used by another user is an unrelated key', async () => {
    const alice = await login('alice');
    const bob = await login('bob');
    const key = randomUUID();

    const first = await postCustomer(alice.headers, { name: 'Shared Name' }, key).expect(201);
    const second = await postCustomer(bob.headers, { name: 'Shared Name' }, key).expect(201);

    expect((second.body as CustomerBody).id).not.toBe((first.body as CustomerBody).id);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(await customerCount()).toBe(2);
  });

  it('the same key value in another tenant is an unrelated key', async () => {
    const alice = await login('tenant-a');
    const key = randomUUID();
    const first = await postCustomer(alice.headers, { name: 'Tenant A Customer' }, key).expect(201);

    const { default: argon2 } = await import('argon2');
    await prisma.user.create({
      data: {
        tenantId: TENANT_B_ID,
        email: 'idem-tenant-b@example.com',
        name: 'Idem B',
        passwordHash: await argon2.hash('SecurePass123'),
        role: 'ADMIN',
      },
    });
    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'idem-tenant-b@example.com', password: 'SecurePass123', tenant: 'tenant-idem-b' })
      .expect(200);
    const tokenB = (loginB.body as { tokens: { accessToken: string } }).tokens.accessToken;

    const second = await postCustomer(
      { Authorization: `Bearer ${tokenB}` },
      { name: 'Tenant A Customer' },
      key,
    ).expect(201);

    expect((second.body as CustomerBody).id).not.toBe((first.body as CustomerBody).id);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(await customerCount(DEFAULT_TENANT_ID)).toBe(1);
    expect(await customerCount(TENANT_B_ID)).toBe(1);
  });

  // ------------------------------------------------------ unavailable result

  it('an applied key without a stored response answers 409 and applies nothing', async () => {
    const admin = await login('lost');
    const key = randomUUID();
    const body = { name: 'Lost Response Inc' };
    // Стан після падіння процесу між комітом і збереженням відповіді: рядок є, відповіді немає
    await prisma.idempotencyKey.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        userId: admin.id,
        key,
        operation: 'POST /api/customers',
        requestHash: requestFingerprint({ method: 'POST', url: '/api/customers', body }),
      },
    });

    const response = await postCustomer(admin.headers, body, key).expect(409);

    expect((response.body as ErrorBody).code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(response.headers['retry-after']).toBe('1');
    expect(await customerCount()).toBe(0);
  });

  // ---------------------------------------------------------------- calendar

  it('a repeated calendar event create makes one event and notifies attendees once', async () => {
    const organizer = await login('organizer');
    const guest = await login('guest', 'USER');
    const key = randomUUID();
    const body = {
      title: 'Kickoff',
      startsAt: '2031-03-10T09:00:00.000Z',
      endsAt: '2031-03-10T10:00:00.000Z',
      attendees: [{ userId: guest.id, role: 'REQUIRED' }],
    };
    const post = (): request.Test =>
      request(app.getHttpServer())
        .post('/api/calendar/events')
        .set(organizer.headers)
        .set(KEY_HEADER, key)
        .send(body);

    const first = await post().expect(201);
    const second = await post().expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.calendarEvent.count()).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: guest.id } })).toBe(1);
  });

  // ------------------------------------------------------------ wiring guard

  it('an endpoint marked idempotent whose handler never claims the key fails loudly', async () => {
    const admin = await login('halfwired');
    const call = (): request.Test =>
      request(app.getHttpServer()).post('/api/test-idempotency/unclaimed').set(admin.headers);

    // Без заголовка шар не втручається
    await call().expect(201);
    // Із заголовком — помилка, а не мовчазна відсутність захисту
    const response = await call().set(KEY_HEADER, randomUUID()).expect(500);
    expect((response.body as ErrorBody).code).toBe('INTERNAL_ERROR');
  });

  // ------------------------------------------------------------------ cleanup

  it('the nightly cleanup deletes keys older than a day and keeps newer ones', async () => {
    const admin = await login('cleanup');
    const row = (key: string, ageHours: number) => ({
      tenantId: DEFAULT_TENANT_ID,
      userId: admin.id,
      key,
      operation: 'POST /api/customers',
      requestHash: 'hash',
      responseStatus: 201,
      createdAt: new Date(Date.now() - ageHours * 60 * 60 * 1000),
    });
    await prisma.idempotencyKey.createMany({ data: [row('old', 25), row('fresh', 23)] });

    await new CleanupProcessedJobsSubscriber(prisma).handle();

    const left = await prisma.idempotencyKey.findMany({ select: { key: true } });
    expect(left.map((k) => k.key)).toEqual(['fresh']);
  });
});
