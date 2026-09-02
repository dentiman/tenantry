/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';

interface GeneralBody {
  name: string;
  slug: string;
  locale: string;
  currency: string;
}

describe('Organization settings API (e2e)', () => {
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
    await prisma.customer.deleteMany();
    await prisma.numberSequence.deleteMany();
    await prisma.numberSeries.deleteMany();
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    // Дефолтний стан воркспейсу між тестами
    await prisma.tenant.update({
      where: { id: DEFAULT_TENANT_ID },
      data: { name: 'Default Tenant', locale: 'en', currency: 'USD' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (
    suffix: string,
    role: 'ADMIN' | 'USER',
  ): Promise<{ Authorization: string }> => {
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `settings-${role.toLowerCase()}-${suffix}@example.com`,
      password: 'SecurePass123',
      role,
    });
    return { Authorization: `Bearer ${tokens.accessToken}` };
  };

  it('returns the general section without platform-only fields', async () => {
    const headers = await login(`${Date.now()}-read`, 'ADMIN');

    const response = await request(app.getHttpServer())
      .get('/api/settings/general')
      .set(headers)
      .expect(200);

    expect(response.body).toEqual({
      name: 'Default Tenant',
      slug: 'default',
      locale: 'en',
      currency: 'USD',
    });
    // isActive і settings — не справа тенанта, назовні не мапляться
    expect(response.body).not.toHaveProperty('isActive');
    expect(response.body).not.toHaveProperty('settings');
    // Власний id організації теж не віддається: він не потрібен клієнту —
    // усі ендпоінти секції адресують її через токен
    expect(response.body).not.toHaveProperty('id');
  });

  it('replaces the section with PUT and journals the change', async () => {
    const headers = await login(`${Date.now()}-write`, 'ADMIN');

    const response = await request(app.getHttpServer())
      .put('/api/settings/general')
      .set(headers)
      .send({ name: 'Acme Corp', locale: 'en', currency: 'eur' })
      .expect(200);

    // Валюта нормалізується до верхнього регістру ще у схемі
    expect(response.body as GeneralBody).toEqual(
      expect.objectContaining({ name: 'Acme Corp', currency: 'EUR' }),
    );

    const feed = await request(app.getHttpServer())
      .get('/api/settings/activity')
      .set(headers)
      .expect(200);
    const items = (feed.body as { items: { type: string; payload: unknown }[] }).items;
    expect(items[0]).toEqual(
      expect.objectContaining({
        type: 'settings.updated',
        payload: { section: 'general' },
      }),
    );
  });

  it('rejects platform-only fields silently and invalid values loudly', async () => {
    const headers = await login(`${Date.now()}-scope`, 'ADMIN');

    // slug і isActive у схемі відсутні — Zod відкидає їх мовчки
    await request(app.getHttpServer())
      .put('/api/settings/general')
      .set(headers)
      .send({ name: 'Acme', locale: 'en', currency: 'USD', slug: 'hijacked', isActive: false })
      .expect(200);

    const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
    expect(tenant?.slug).toBe('default');
    expect(tenant?.isActive).toBe(true);

    await request(app.getHttpServer())
      .put('/api/settings/general')
      .set(headers)
      .send({ name: 'Acme', locale: 'en', currency: 'US DOLLAR' })
      .expect(400);
  });

  it('lets a member read but not write', async () => {
    const headers = await login(`${Date.now()}-member`, 'USER');

    await request(app.getHttpServer()).get('/api/settings/general').set(headers).expect(200);
    await request(app.getHttpServer()).get('/api/settings/bootstrap').set(headers).expect(200);

    await request(app.getHttpServer())
      .put('/api/settings/general')
      .set(headers)
      .send({ name: 'Nope', locale: 'en', currency: 'USD' })
      .expect(403);
  });

  it('serves a bootstrap slice for the SPA', async () => {
    const headers = await login(`${Date.now()}-bootstrap`, 'USER');

    const response = await request(app.getHttpServer())
      .get('/api/settings/bootstrap')
      .set(headers)
      .expect(200);

    expect(response.body).toEqual({
      general: { name: 'Default Tenant', slug: 'default', locale: 'en', currency: 'USD' },
      features: {},
    });
  });

  it('gives a new customer the currency of the organization, not a hardcoded default', async () => {
    const headers = await login(`${Date.now()}-currency`, 'ADMIN');
    await request(app.getHttpServer())
      .put('/api/settings/general')
      .set(headers)
      .send({ name: 'Acme Corp', locale: 'en', currency: 'EUR' })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name: 'Inherits Currency' })
      .expect(201);
    expect((created.body as { currency: string }).currency).toBe('EUR');

    // Явно передана валюта перекриває дефолт компанії
    const explicit = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name: 'Explicit Currency', currency: 'PLN' })
      .expect(201);
    expect((explicit.body as { currency: string }).currency).toBe('PLN');
  });

  it('does not expose another tenant organization', async () => {
    const headers = await login(`${Date.now()}-isolation`, 'ADMIN');
    const other = await prisma.tenant.create({
      data: { slug: `other-org-${String(Date.now())}`, name: 'Other Co', currency: 'GBP' },
    });

    // RLS показує рівно один рядок — той, що в контексті токена
    const response = await request(app.getHttpServer())
      .get('/api/settings/general')
      .set(headers)
      .expect(200);
    expect((response.body as GeneralBody).slug).toBe('default');

    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
