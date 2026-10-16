/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser } from './test-users';

interface SeriesBody {
  name: string;
  prefix: string;
  padding: number;
  startValue: number;
  resetPeriod: string;
  resettable: boolean;
  nextNumber: number;
  nextLabel: string;
  isCustomized: boolean;
}

interface CustomerBody {
  id: string;
  number: number;
  numberLabel: string;
}

describe('Numbering API (e2e)', () => {
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
    await app.close();
  });

  const admin = async (suffix: string): Promise<{ Authorization: string }> => {
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `numbering-${suffix}@example.com`,
      password: 'SecurePass123',
      role: 'ADMIN',
    });
    return { Authorization: `Bearer ${tokens.accessToken}` };
  };

  const member = async (suffix: string): Promise<{ Authorization: string }> => {
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `member-${suffix}@example.com`,
      password: 'SecurePass123',
      role: 'USER',
    });
    return { Authorization: `Bearer ${tokens.accessToken}` };
  };

  const series = async (headers: { Authorization: string }): Promise<SeriesBody> => {
    const response = await request(app.getHttpServer())
      .get('/api/settings/numbering')
      .set(headers)
      .expect(200);
    const items = (response.body as { items: SeriesBody[] }).items;
    const customer = items.find((item) => item.name === 'customer');
    if (!customer) throw new Error('customer series missing');
    return customer;
  };

  const createCustomer = async (
    headers: { Authorization: string },
    name = 'Acme',
  ): Promise<CustomerBody> => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name })
      .expect(201);
    return response.body as CustomerBody;
  };

  it('serves defaults from code before the tenant customizes anything', async () => {
    const headers = await admin(`${Date.now()}-defaults`);

    expect(await series(headers)).toEqual(
      expect.objectContaining({
        name: 'customer',
        prefix: 'C-',
        padding: 6,
        startValue: 1,
        resetPeriod: 'NONE',
        // Майстер-дані не скидаються за періодом — перемикача бути не має
        resettable: false,
        nextNumber: 1,
        nextLabel: 'C-000001',
        // Рядка в БД немає: дефолти живуть у коді
        isCustomized: false,
      }),
    );
    expect(await prisma.numberSeries.count()).toBe(0);
  });

  it('applies startValue to the first customer of the series', async () => {
    const headers = await admin(`${Date.now()}-start`);

    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ startValue: 5000, prefix: 'ACC-', padding: 4 })
      .expect(200);

    const customer = await createCustomer(headers, 'Migrated Co');
    // Початковий номер — саме ПЕРШИЙ виданий, а не перший+1
    expect(customer.number).toBe(5000);
    expect(customer.numberLabel).toBe('ACC-5000');

    const next = await createCustomer(headers, 'Second Co');
    expect(next.number).toBe(5001);
  });

  it('ignores startValue once the counter has started', async () => {
    const headers = await admin(`${Date.now()}-started`);
    await createCustomer(headers, 'First');

    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ startValue: 9000 })
      .expect(200);

    // Діапазон, який уже роздали, заднім числом не переписують
    const second = await createCustomer(headers, 'Second');
    expect(second.number).toBe(2);
    expect((await series(headers)).nextNumber).toBe(3);
  });

  it('moves the counter forward but never backwards', async () => {
    const headers = await admin(`${Date.now()}-bump`);
    await createCustomer(headers, 'First');

    const bumped = await request(app.getHttpServer())
      .post('/api/settings/numbering/customer/next-number')
      .set(headers)
      .send({ nextNumber: 2000 })
      .expect(200);
    expect((bumped.body as SeriesBody).nextNumber).toBe(2000);
    expect((await createCustomer(headers, 'Jumped')).number).toBe(2000);

    // Спроба знизити — тихий no-op: попередні номери вже видані
    const lowered = await request(app.getHttpServer())
      .post('/api/settings/numbering/customer/next-number')
      .set(headers)
      .send({ nextNumber: 5 })
      .expect(200);
    expect((lowered.body as SeriesBody).nextNumber).toBe(2001);
  });

  it('reformats existing customers when the format changes', async () => {
    const headers = await admin(`${Date.now()}-format`);
    const customer = await createCustomer(headers, 'Reformat Co');
    expect(customer.numberLabel).toBe('C-000001');

    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ prefix: 'K', padding: 3 })
      .expect(200);

    // Лейбл — presentation, тому перемальовується; ідентичність (number) незмінна
    const reloaded = await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}`)
      .set(headers)
      .expect(200);
    expect((reloaded.body as CustomerBody).numberLabel).toBe('K001');
    expect((reloaded.body as CustomerBody).number).toBe(1);
  });

  it('rejects an unknown series and an invalid value', async () => {
    const headers = await admin(`${Date.now()}-invalid`);

    await request(app.getHttpServer())
      .patch('/api/settings/numbering/invoice')
      .set(headers)
      .send({ padding: 2 })
      .expect(404);

    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ startValue: 0 })
      .expect(400);
  });

  it('lets any member read the series but only ADMIN change it', async () => {
    const headers = await member(`${Date.now()}-member`);

    // Наступний номер видно в UI створення — читання відкрите всім
    await request(app.getHttpServer()).get('/api/settings/numbering').set(headers).expect(200);

    // Зсув нумерації стосується всієї компанії — 403, а не 404: ресурс існує
    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ padding: 2 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/settings/numbering/customer/next-number')
      .set(headers)
      .send({ nextNumber: 99 })
      .expect(403);
  });

  it('journals who shifted the counter, with the value', async () => {
    const headers = await admin(`${Date.now()}-journal`);
    await request(app.getHttpServer())
      .post('/api/settings/numbering/customer/next-number')
      .set(headers)
      .send({ nextNumber: 300 })
      .expect(200);

    const feed = await request(app.getHttpServer())
      .get('/api/settings/activity')
      .set(headers)
      .expect(200);
    const items = (feed.body as { items: { type: string; payload: unknown }[] }).items;
    expect(items[0]).toEqual(
      expect.objectContaining({
        type: 'settings.numbering_shifted',
        payload: { series: 'customer', nextNumber: 300 },
      }),
    );
  });

  it('keeps numbering independent per tenant', async () => {
    const headers = await admin(`${Date.now()}-tenants`);
    await request(app.getHttpServer())
      .patch('/api/settings/numbering/customer')
      .set(headers)
      .send({ startValue: 700 })
      .expect(200);
    await createCustomer(headers, 'Ours');

    const otherTenant = await prisma.tenant.create({
      data: { slug: `numbering-${String(Date.now())}`, name: 'Other' },
    });

    // Конфіг і лічильник сусіда — окремі рядки; наш startValue на нього не діє
    expect(await prisma.numberSeries.count({ where: { tenantId: otherTenant.id } })).toBe(0);
    expect(await prisma.numberSequence.count({ where: { tenantId: otherTenant.id } })).toBe(0);

    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});
