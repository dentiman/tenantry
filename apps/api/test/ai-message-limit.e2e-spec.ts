/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { AiUsageQuotaService, startOfUtcDay } from '@saas-skeleton/shared';
import { AI_MESSAGE_LIMIT_CODE } from '@saas-skeleton/contracts';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';
import { sentJobs } from './__mocks__/pg-boss';

const LIMIT = 3;

/**
 * Добовий ліміт ПИТАНЬ на користувача (`AI_QUOTA_USER_DAILY_MESSAGES`, демо-стенд). Окремий сьют,
 * а не блок у `ai.e2e-spec.ts`: конфіг будується при створенні застосунку, тож ліміт мусить бути
 * в env ДО `compile()`, а там багато тестів питають більше трьох разів з одного юзера.
 * Генерація не відбувається (pg-boss замокано) — перевіряється рівно рубіж `ask()`.
 */
describe('AI daily message limit (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let quota: AiUsageQuotaService;
  let tenantTx: TenantTransactions;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_QUOTA_USER_DAILY_MESSAGES = String(LIMIT);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    quota = app.get(AiUsageQuotaService);
    tenantTx = app.get(TenantTransactions);
    tenantContext = app.get(TenantContextService);
  });

  beforeEach(async () => {
    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
    await prisma.aiUsageCounter.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    sentJobs.reset();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AI_ENABLED;
    delete process.env.AI_QUOTA_USER_DAILY_MESSAGES;
  });

  const periodStart = startOfUtcDay(new Date());

  const login = async (
    suffix: string,
  ): Promise<{ headers: { Authorization: string }; userId: string }> => {
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email: `ai-limit-${suffix}@example.com`,
      password: 'SecurePass123',
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, userId: user.id };
  };

  const ask = (headers: { Authorization: string }, text: string) =>
    request(app.getHttpServer()).post('/api/ai/conversation/messages').set(headers).send({ text });

  /** Відповідь уже готова — інакше наступне питання впирається в 409 «зайнято», а не в ліміт */
  const completeReplies = () => prisma.aiMessage.updateMany({ data: { status: 'COMPLETE' } });

  const countOf = async (userId: string): Promise<number | undefined> =>
    (
      await prisma.aiUsageCounter.findUnique({
        where: {
          tenantId_userId_periodStart: { tenantId: DEFAULT_TENANT_ID, userId, periodStart },
        },
        select: { messageCount: true },
      })
    )?.messageCount;

  it('accepts exactly the daily limit of questions, then refuses the next one', async () => {
    const { headers, userId } = await login(`${Date.now()}-limit`);

    for (let i = 1; i <= LIMIT; i++) {
      await ask(headers, `question ${String(i)}`).expect(202);
      await completeReplies();
    }

    const refused = await ask(headers, 'one too many').expect(400);

    expect(
      (refused.body as { fieldErrors: { field: string; code: string }[] }).fieldErrors[0],
    ).toMatchObject({ field: 'text', code: AI_MESSAGE_LIMIT_CODE });
    // Четвертого питання не існує, job у чергу не пішов, лічильник став на ліміті
    expect(await prisma.aiMessage.count({ where: { role: 'USER' } })).toBe(LIMIT);
    expect(sentJobs.forQueue('ai.generate-reply/ai-generator')).toHaveLength(LIMIT);
    expect(await countOf(userId)).toBe(LIMIT);
  });

  it('counts per user: one user hitting the limit does not block another', async () => {
    const heavy = await login(`${Date.now()}-heavy`);
    const light = await login(`${Date.now()}-light`);

    for (let i = 0; i < LIMIT; i++) {
      await ask(heavy.headers, `q${String(i)}`).expect(202);
      await completeReplies();
    }
    await ask(heavy.headers, 'blocked').expect(400);

    await ask(light.headers, 'still fine').expect(202);
    expect(await countOf(light.userId)).toBe(1);
  });

  it('does not consume a question when the ask itself is refused as busy (409)', async () => {
    const { headers, userId } = await login(`${Date.now()}-busy`);

    await ask(headers, 'first').expect(202); // відповідь лишилась PENDING
    await ask(headers, 'second while busy').expect(409);

    // Відкат транзакції `ask()` повернув і резерв: ліміт з'їдає лише питання, що справді відбулось
    expect(await countOf(userId)).toBe(1);
  });

  it('reservations race safely: N concurrent reservations for one user pass exactly LIMIT times', async () => {
    const user = await createTestUser(prisma, {
      email: `ai-limit-race-${String(Date.now())}@example.com`,
    });
    const now = new Date();

    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () =>
        tenantContext.runWith(DEFAULT_TENANT_ID, () =>
          tenantTx.withTenantTx((tx) =>
            quota.reserveMessage(tx, DEFAULT_TENANT_ID, user.id, now),
          ),
        ),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(LIMIT);
    expect(await countOf(user.id)).toBe(LIMIT);
  });
});
