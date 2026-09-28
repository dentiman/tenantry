/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SystemPrismaService } from '@saas-skeleton/database';
import { AI_CONFIG, type AiConfig } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createTestUser, DEFAULT_TENANT_ID } from './test-users';
import { AiPurgeConversationsSubscriber } from '../../worker/src/subscribers/ai-purge-conversations.subscriber';

/**
 * Нічна чистка AI-розмов (ai-1e, docs/ai-assistant.md §9.2) проти СПРАВЖНЬОГО Postgres.
 * HTTP-шар і pg-boss тут не потрібні — субскрайбер сам по собі плаский клас, що бере
 * лише `SystemPrismaService`+`AiConfig`, тож інстанціюється напряму, тим самим патерном,
 * що `ai-state.e2e-spec.ts` для `AiMessageStateService`. Саме реальний Postgres, а не
 * мокований Prisma, підтверджує, що `deleteMany` справді каскадить повідомлення й не
 * зупиняється на межі одного тенанта.
 */
describe('AiPurgeConversationsSubscriber (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let subscriber: AiPurgeConversationsSubscriber;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    const config = app.get<AiConfig>(AI_CONFIG);
    subscriber = new AiPurgeConversationsSubscriber(prisma, config);
  });

  beforeEach(async () => {
    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
    await prisma.tenant.deleteMany({ where: { id: { not: DEFAULT_TENANT_ID } } });
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const DAY_MS = 24 * 60 * 60 * 1000;
  // AI_CONFIG у тестовому середовищі не задає AI_RETENTION_DAYS — дефолт з ai.config.ts
  const RETENTION_DAYS = 90;

  async function seedConversation(
    tenantId: string,
    userId: string,
    overrides: { createdAt: Date; lastMessageAt: Date | null },
  ): Promise<string> {
    const conversation = await prisma.aiConversation.create({
      data: {
        tenantId,
        userId,
        status: 'ACTIVE',
        createdAt: overrides.createdAt,
        lastMessageAt: overrides.lastMessageAt,
      },
    });
    await prisma.aiMessage.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        seq: 0,
        role: 'USER',
        status: 'COMPLETE',
        content: 'old question',
      },
    });
    return conversation.id;
  }

  it('purges a conversation whose last activity is older than the retention window', async () => {
    const user = await createTestUser(prisma, {
      email: `ai-retention-old-${String(Date.now())}@example.com`,
    });
    const staleId = await seedConversation(DEFAULT_TENANT_ID, user.id, {
      createdAt: new Date(Date.now() - (RETENTION_DAYS + 10) * DAY_MS),
      lastMessageAt: new Date(Date.now() - (RETENTION_DAYS + 1) * DAY_MS),
    });

    await subscriber.handle();

    expect(await prisma.aiConversation.findUnique({ where: { id: staleId } })).toBeNull();
    expect(await prisma.aiMessage.count({ where: { conversationId: staleId } })).toBe(0);
  });

  it('leaves a recently active conversation untouched', async () => {
    const user = await createTestUser(prisma, {
      email: `ai-retention-fresh-${String(Date.now())}@example.com`,
    });
    // Стара за СТВОРЕННЯМ, але недавня активність — не має бути видалена (design.md D2)
    const freshId = await seedConversation(DEFAULT_TENANT_ID, user.id, {
      createdAt: new Date(Date.now() - (RETENTION_DAYS + 10) * DAY_MS),
      lastMessageAt: new Date(Date.now() - 1 * DAY_MS),
    });

    await subscriber.handle();

    expect(await prisma.aiConversation.findUnique({ where: { id: freshId } })).not.toBeNull();
  });

  it('purges a conversation with no messages by createdAt when lastMessageAt is null', async () => {
    const user = await createTestUser(prisma, {
      email: `ai-retention-empty-${String(Date.now())}@example.com`,
    });
    const conversation = await prisma.aiConversation.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        userId: user.id,
        status: 'ACTIVE',
        createdAt: new Date(Date.now() - (RETENTION_DAYS + 1) * DAY_MS),
        lastMessageAt: null,
      },
    });

    await subscriber.handle();

    expect(await prisma.aiConversation.findUnique({ where: { id: conversation.id } })).toBeNull();
  });

  it('purges past-window conversations across every tenant, not only the first one found', async () => {
    const otherTenant = await prisma.tenant.create({
      data: { slug: `ai-retention-${String(Date.now())}`, name: 'Other tenant' },
    });
    const userA = await createTestUser(prisma, {
      email: `ai-retention-tenant-a-${String(Date.now())}@example.com`,
    });
    const userB = await prisma.user.create({
      data: { tenantId: otherTenant.id, email: `ai-retention-tenant-b-${String(Date.now())}@example.com`, role: 'USER' },
    });

    const staleA = await seedConversation(DEFAULT_TENANT_ID, userA.id, {
      createdAt: new Date(Date.now() - (RETENTION_DAYS + 5) * DAY_MS),
      lastMessageAt: new Date(Date.now() - (RETENTION_DAYS + 5) * DAY_MS),
    });
    const staleB = await seedConversation(otherTenant.id, userB.id, {
      createdAt: new Date(Date.now() - (RETENTION_DAYS + 5) * DAY_MS),
      lastMessageAt: new Date(Date.now() - (RETENTION_DAYS + 5) * DAY_MS),
    });

    await subscriber.handle();

    expect(await prisma.aiConversation.findUnique({ where: { id: staleA } })).toBeNull();
    expect(await prisma.aiConversation.findUnique({ where: { id: staleB } })).toBeNull();
  });
});
