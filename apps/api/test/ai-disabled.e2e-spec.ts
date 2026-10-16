/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SystemPrismaModule, SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser } from './test-users';
import { sentJobs } from './__mocks__/pg-boss';

/**
 * ОКРЕМИЙ ФАЙЛ, а не другий describe у `ai.e2e-spec.ts`: прапорець читається
 * фабрикою на старті застосунку, тож вимкнений стан вимагає власного інстансу
 * Nest. Два застосунки в ОДНОМУ файлі ламають сусідні сьюти — supertest віддає
 * наступному тесту сокет до вже закритого сервера, і запит приїжджає з порожнім
 * тілом (спіймано живим прогоном: логін у users.e2e-spec віддав 400 замість 401).
 * Та сама причина, через яку `setup-env.ts` вимикає keep-alive.
 */
describe('AI assistant API — disabled installation (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let headers: { Authorization: string };

  beforeAll(async () => {
    process.env.AI_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);

    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    sentJobs.reset();

    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `ai-disabled-${Date.now()}@example.com`,
      password: 'SecurePass123',
      role: 'USER',
    });
    headers = { Authorization: `Bearer ${tokens.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AI_ENABLED;
  });

  it('refuses every assistant route with 403', async () => {
    await request(app.getHttpServer()).get('/api/ai/conversation').set(headers).expect(403);
    await request(app.getHttpServer())
      .post('/api/ai/conversation/messages')
      .set(headers)
      .send({ text: 'hello' })
      .expect(403);
    await request(app.getHttpServer()).post('/api/ai/conversation/reset').set(headers).expect(403);
  });

  it('creates nothing and enqueues nothing while disabled', async () => {
    await request(app.getHttpServer()).get('/api/ai/conversation').set(headers).expect(403);

    expect(await prisma.aiConversation.count()).toBe(0);
    expect(sentJobs.all()).toHaveLength(0);
  });

  it('reports features.ai = false in the bootstrap slice', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/settings/bootstrap')
      .set(headers)
      .expect(200);

    expect((response.body as { features: Record<string, boolean> }).features.ai).toBe(false);
  });
});
