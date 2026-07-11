/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';
import { PrismaService } from '@saas-skeleton/database';

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createUserPayload = (
    suffix: string,
  ): { email: string; name: string; role: 'ADMIN' | 'USER' } => ({
    email: `user-${suffix}@example.com`,
    name: `User ${suffix}`,
    role: 'USER',
  });

  const createAuthUserPayload = (
    suffix: string,
  ): { email: string; password: string; name: string } => ({
    email: `auth-${suffix}@example.com`,
    password: 'SecurePass123',
    name: `Auth ${suffix}`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    const httpAdapter = app.getHttpAdapter();
    app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

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

  const createAuthHeaders = async (suffix: string): Promise<{ Authorization: string }> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(createAuthUserPayload(suffix))
      .expect(201);

    return {
      Authorization: `Bearer ${String(response.body.tokens.accessToken)}`,
    };
  };

  it('creates a user', async () => {
    const payload = createUserPayload(`${Date.now()}-create`);
    const headers = await createAuthHeaders(`${Date.now()}-create-admin`);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(payload)
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        email: payload.email,
        name: payload.name,
        role: payload.role,
        isActive: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
  });

  it('lists users with pagination and filtering', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-list-admin`);
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@example.com`,
        name: 'Alice Admin',
        role: 'ADMIN',
      },
    });

    await prisma.user.create({
      data: {
        email: `user-${Date.now()}@example.com`,
        name: 'Bob User',
        role: 'USER',
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ role: 'ADMIN', search: 'alice', page: 1, limit: 10 })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(10);
    expect(response.body.totalPages).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        id: admin.id,
        email: admin.email,
        role: 'ADMIN',
      }),
    );
  });

  it('gets user by id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-get-admin`);
    const user = await prisma.user.create({
      data: createUserPayload(`${Date.now()}-get`),
    });

    const response = await request(app.getHttpServer())
      .get(`/api/users/${user.id}`)
      .set(headers)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      }),
    );
  });

  it('updates a user', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-update-admin`);
    const user = await prisma.user.create({
      data: createUserPayload(`${Date.now()}-update`),
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/users/${user.id}`)
      .set(headers)
      .send({ name: 'Updated Name', role: 'ADMIN' })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: user.id,
        name: 'Updated Name',
        role: 'ADMIN',
      }),
    );
  });

  it('deletes a user', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-delete-admin`);
    const user = await prisma.user.create({
      data: createUserPayload(`${Date.now()}-delete`),
    });

    await request(app.getHttpServer()).delete(`/api/users/${user.id}`).set(headers).expect(204);

    await request(app.getHttpServer()).get(`/api/users/${user.id}`).set(headers).expect(404);
  });

  it('returns 400 for invalid create payload', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid-create-admin`);
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({ email: 'not-an-email', role: 'OWNER' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
      }),
    );
    expect(Array.isArray(response.body.errors)).toBe(true);
  });

  it('returns 409 for duplicate email', async () => {
    const payload = createUserPayload(`${Date.now()}-duplicate`);
    const headers = await createAuthHeaders(`${Date.now()}-duplicate-admin`);

    await request(app.getHttpServer()).post('/api/users').set(headers).send(payload).expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send(payload)
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
      }),
    );
    expect(String(response.body.message)).toContain('Unique constraint violation');
  });

  it('returns 404 for get by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-get-admin`);
    const response = await request(app.getHttpServer())
      .get('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
  });

  it('returns 404 for update by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-update-admin`);
    const response = await request(app.getHttpServer())
      .patch('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .send({ name: 'Nobody' })
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
    expect(response.body.message).toBe('Resource not found');
  });

  it('returns 404 for delete by non-existing user id', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-missing-delete-admin`);
    const response = await request(app.getHttpServer())
      .delete('/api/users/00000000-0000-4000-8000-000000000000')
      .set(headers)
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
    expect(response.body.message).toBe('Resource not found');
  });

  it('returns 400 for invalid list query params', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-invalid-list-admin`);
    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .query({ page: 0, limit: 101, isActive: 'not-boolean' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
      }),
    );
    expect(Array.isArray(response.body.errors)).toBe(true);
  });
});
