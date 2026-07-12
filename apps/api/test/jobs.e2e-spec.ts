/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '@saas-skeleton/database';

describe('Jobs monitoring API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createAuthHeaders = async (suffix: string): Promise<{ Authorization: string }> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `jobs-${suffix}@example.com`,
        password: 'SecurePass123',
        name: `Jobs ${suffix}`,
      })
      .expect(201);

    return {
      Authorization: `Bearer ${String(response.body.tokens.accessToken)}`,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);

    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth', async () => {
    await request(app.getHttpServer()).get('/api/jobs').expect(401);
    await request(app.getHttpServer()).get('/api/jobs/queues').expect(401);
  });

  // У тестовій БД схеми pgboss немає (pg-boss замокано) — сервіс має
  // граційно віддавати порожні дані, а не 500
  it('returns empty list when pgboss schema is absent', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-list`);

    const response = await request(app.getHttpServer())
      .get('/api/jobs')
      .set(headers)
      .query({ page: 1, limit: 10 })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
    );
  });

  it('returns empty queue stats when pgboss schema is absent', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-queues`);

    const response = await request(app.getHttpServer())
      .get('/api/jobs/queues')
      .set(headers)
      .expect(200);

    expect(response.body).toEqual({ queues: [] });
  });

  it('validates state filter', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid`);

    await request(app.getHttpServer())
      .get('/api/jobs')
      .set(headers)
      .query({ page: 1, limit: 10, state: 'exploded' })
      .expect(400);
  });
});
