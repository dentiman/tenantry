/// <reference types="jest" />

// MT-3: control plane e2e — операторський auth, CRUD тенантів, моніторинг черг,
// security boundary між plane-ами (токени не крос-валідні).

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaService } from '@saas-skeleton/database';

const OPERATOR_EMAIL = 'operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';

describe('Platform API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.platformUser.deleteMany();
    // tenants створюються тестами — чистимо все, крім дефолтного (він із міграції)
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { not: 'default' } } });
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'Operator',
        passwordHash: await argon2.hash(OPERATOR_PASSWORD),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const loginOperator = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    return String(response.body.accessToken);
  };

  describe('platform auth', () => {
    it('logs an operator in and serves /auth/me', async () => {
      const token = await loginOperator();
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.email).toBe(OPERATOR_EMAIL);
      expect(me.body.passwordHash).toBeUndefined();
    });

    it('rejects wrong credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: OPERATOR_EMAIL, password: 'WrongPass123' })
        .expect(401);
    });

    it('protects endpoints without token', async () => {
      await request(app.getHttpServer()).get('/api/tenants').expect(401);
      await request(app.getHttpServer()).get('/api/jobs?page=1&limit=10').expect(401);
    });

    it('rejects a TENANT-plane token (інший секрет — security boundary)', async () => {
      // Токен, підписаний tenant-секретом (JWT_SECRET) — формально валідний JWT
      // з валідними клеймами, але для platform-guard він чужий
      const tenantJwt = new JwtService({
        secret: process.env.JWT_SECRET ?? 'ci-only-secret-not-for-production-min-32-chars',
        signOptions: { expiresIn: '15m' },
      });
      const foreignToken = await tenantJwt.signAsync({
        sub: 'x',
        email: 'x@x.com',
        role: 'ADMIN',
        tenantId: '00000000-0000-4000-8000-000000000001',
      });

      await request(app.getHttpServer())
        .get('/api/tenants')
        .set('Authorization', `Bearer ${foreignToken}`)
        .expect(401);
    });
  });

  describe('tenants CRUD', () => {
    it('creates a tenant with its first admin atomically', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'acme',
          name: 'Acme Inc',
          admin: { email: 'boss@acme.test', password: 'AcmeAdmin123', name: 'Boss' },
        })
        .expect(201);

      expect(response.body).toMatchObject({ slug: 'acme', name: 'Acme Inc', isActive: true });

      const admin = await prisma.user.findFirst({ where: { email: 'boss@acme.test' } });
      expect(admin?.tenantId).toBe(String(response.body.id));
      expect(admin?.role).toBe('ADMIN');
    });

    it('rejects duplicate slug with 409 field error', async () => {
      const token = await loginOperator();
      const payload = {
        slug: 'dup-tenant',
        name: 'Dup',
        admin: { email: 'dup@dup.test', password: 'DupAdmin123' },
      };
      await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...payload, admin: { email: 'other@dup.test', password: 'DupAdmin123' } })
        .expect(409);
      expect(response.body.fieldErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'slug' })]),
      );
    });

    it('rejects invalid slug format with 400', async () => {
      const token = await loginOperator();
      await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'Not A Slug!',
          name: 'Bad',
          admin: { email: 'bad@bad.test', password: 'BadAdmin123' },
        })
        .expect(400);
    });

    it('suspends and resumes a tenant', async () => {
      const token = await loginOperator();
      const created = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          slug: 'pausable',
          name: 'Pausable',
          admin: { email: 'p@p.test', password: 'PauseAdmin123' },
        })
        .expect(201);
      const id = String(created.body.id);

      const suspended = await request(app.getHttpServer())
        .patch(`/api/tenants/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);
      expect(suspended.body.isActive).toBe(false);

      const resumed = await request(app.getHttpServer())
        .patch(`/api/tenants/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: true })
        .expect(200);
      expect(resumed.body.isActive).toBe(true);
    });

    it('lists tenants including the default one', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/tenants')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const slugs = (response.body.items as { slug: string }[]).map((t) => t.slug);
      expect(slugs).toContain('default');
    });
  });

  describe('jobs monitoring (переїхало з tenant-api — гейт MT-3)', () => {
    it('lists jobs (пусто або дані — pgboss може бути відсутній у тест-БД)', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/jobs?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    });

    it('serves queue stats', async () => {
      const token = await loginOperator();
      const response = await request(app.getHttpServer())
        .get('/api/jobs/queues')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(response.body.queues)).toBe(true);
    });
  });
});
