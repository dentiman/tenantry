/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SystemPrismaModule, SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { AiUsageQuotaService, startOfUtcDay } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createTestUser, DEFAULT_TENANT_ID } from './test-users';

/**
 * `AiUsageQuotaService` проти СПРАВЖНЬОГО Postgres (ai-1d, design.md D4). HTTP-шар
 * і генерація тут не потрібні: ask.e2e-spec.ts уже перевіряє рубіж checkQuota() через
 * ендпоінт (pg-boss замокано), а worker-сьют — що finalize() кличе deduct() лише
 * коли є usage. Тут — рівно те, на чому тримається «конкурентні ходи не списують
 * двічі»: атомарність самого upsert-інкременту під конкурентним навантаженням, яку
 * мокований Prisma підтвердити не може (той самий прийом, що ai-state.e2e-spec.ts
 * для AiMessageStateService).
 */
describe('AiUsageQuotaService (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let quota: AiUsageQuotaService;
  let tenantTx: TenantTransactions;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    quota = app.get(AiUsageQuotaService);
    tenantTx = app.get(TenantTransactions);
    tenantContext = app.get(TenantContextService);
  });

  beforeEach(async () => {
    await prisma.aiUsageCounter.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const now = new Date();
  const periodStart = startOfUtcDay(now);

  const readCounter = (tenantId: string, userId: string) =>
    prisma.aiUsageCounter.findUnique({
      where: { tenantId_userId_periodStart: { tenantId, userId, periodStart } },
    });

  it('two concurrent deduct() calls for the same user/period both land — sum is exact, neither lost', async () => {
    const user = await createTestUser(prisma, { email: `quota-race-${String(Date.now())}@example.com` });

    await Promise.all([
      tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        tenantTx.withTenantTx((tx) =>
          quota.deduct(tx, DEFAULT_TENANT_ID, user.id, now, {
            promptTokens: 1_000,
            cachedPromptTokens: 0,
            completionTokens: 100,
          }),
        ),
      ),
      tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        tenantTx.withTenantTx((tx) =>
          quota.deduct(tx, DEFAULT_TENANT_ID, user.id, now, {
            promptTokens: 2_000,
            cachedPromptTokens: 0,
            completionTokens: 200,
          }),
        ),
      ),
    ]);

    const row = await readCounter(DEFAULT_TENANT_ID, user.id);
    expect(row?.promptTokens).toBe(3_000);
    expect(row?.completionTokens).toBe(300);
  });

  it('deduct() on a fresh period creates the row; on an existing period it increments it', async () => {
    const user = await createTestUser(prisma, { email: `quota-upsert-${String(Date.now())}@example.com` });

    await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) =>
        quota.deduct(tx, DEFAULT_TENANT_ID, user.id, now, {
          promptTokens: 10,
          cachedPromptTokens: 4,
          completionTokens: 5,
        }),
      ),
    );
    let row = await readCounter(DEFAULT_TENANT_ID, user.id);
    expect(row).toMatchObject({ promptTokens: 10, cachedPromptTokens: 4, completionTokens: 5 });

    await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) =>
        quota.deduct(tx, DEFAULT_TENANT_ID, user.id, now, {
          promptTokens: 1,
          cachedPromptTokens: 1,
          completionTokens: 1,
        }),
      ),
    );
    row = await readCounter(DEFAULT_TENANT_ID, user.id);
    expect(row).toMatchObject({ promptTokens: 11, cachedPromptTokens: 5, completionTokens: 6 });
  });

  it('checkQuota: under both limits -> null; at/over the user limit -> "user"; tenant aggregate at/over its limit (user still under theirs) -> "tenant"', async () => {
    const userUnder = await createTestUser(prisma, { email: `quota-check-under-${String(Date.now())}@example.com` });
    await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) => quota.checkQuota(tx, DEFAULT_TENANT_ID, userUnder.id, now)),
    ).then((result) => {
      expect(result).toBeNull();
    });

    const userAtLimit = await createTestUser(prisma, { email: `quota-check-at-${String(Date.now())}@example.com` });
    await prisma.aiUsageCounter.create({
      data: { tenantId: DEFAULT_TENANT_ID, userId: userAtLimit.id, periodStart, promptTokens: 1_000_000, completionTokens: 0 },
    });
    const userResult = await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) => quota.checkQuota(tx, DEFAULT_TENANT_ID, userAtLimit.id, now)),
    );
    expect(userResult).toEqual({ scope: 'user' });

    const tenantUser = await createTestUser(prisma, { email: `quota-check-tenant-${String(Date.now())}@example.com` });
    const others = await Promise.all(
      [0, 1].map((i) =>
        createTestUser(prisma, { email: `quota-check-tenant-other-${String(i)}-${String(Date.now())}@example.com` }),
      ),
    );
    await prisma.aiUsageCounter.createMany({
      data: others.map((u) => ({
        tenantId: DEFAULT_TENANT_ID,
        userId: u.id,
        periodStart,
        promptTokens: 5_000_000,
        completionTokens: 0,
      })),
    });
    const tenantResult = await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) => quota.checkQuota(tx, DEFAULT_TENANT_ID, tenantUser.id, now)),
    );
    expect(tenantResult).toEqual({ scope: 'tenant' });
  });
});
