/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { sentJobs } from './__mocks__/pg-boss';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

// Межу 50 000 опускаємо до 3, щоб перевірити відмову без пʼятдесяти тисяч рядків
jest.mock('@saas-skeleton/contracts', () => ({
  ...jest.requireActual<Record<string, unknown>>('@saas-skeleton/contracts'),
  CUSTOMER_EXPORT_MAX_ROWS: 3,
}));

/** openspec customers/export — «Exports have an upper bound» */
describe('Customer export cap (e2e)', () => {
  let app: INestApplication;
  let system: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, SystemPrismaModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    system = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    sentJobs.reset();
    await system.userOperation.deleteMany();
    await system.customer.deleteMany();
    await system.authSession.deleteMany();
    await system.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses an export over the limit before creating anything', async () => {
    const { tokens } = await createAndLoginTestUser(app, system, {
      email: 'uo-cap@example.com',
      password: 'SecurePass123',
      name: 'UO cap',
    });
    await system.customer.createMany({
      data: [1, 2, 3, 4].map((number) => ({ tenantId: DEFAULT_TENANT_ID, number, name: `C${String(number)}` })),
    });

    const response = await request(app.getHttpServer())
      .post('/api/customers/export')
      .set({ Authorization: `Bearer ${tokens.accessToken}` })
      .send({})
      .expect(400);

    const body = response.body as { fieldErrors?: { code?: string; params?: { maximum?: number } }[] };
    expect(body.fieldErrors?.[0]).toEqual(
      expect.objectContaining({ code: 'export_too_large', params: expect.objectContaining({ maximum: 3 }) }),
    );
    expect(await system.userOperation.count()).toBe(0);
    expect(sentJobs.all()).toHaveLength(0);

    // На межі — дозволено
    await system.customer.deleteMany({ where: { number: 4 } });
    await request(app.getHttpServer())
      .post('/api/customers/export')
      .set({ Authorization: `Bearer ${tokens.accessToken}` })
      .send({})
      .expect(202);
  });
});
