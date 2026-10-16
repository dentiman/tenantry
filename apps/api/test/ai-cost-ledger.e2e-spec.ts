/// <reference types="jest" />
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  Prisma,
  PrismaModule,
  PrismaService,
  SystemPrismaModule, SystemPrismaService,
  TenancyModule,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { AiUsageLedger, loadAiConfig, type UsageEntry } from '@saas-skeleton/shared';
import { AiPurgeConversationsSubscriber } from '../../worker/src/subscribers/ai-purge-conversations.subscriber';
import { TEST_DB_NAME } from './test-database';

/**
 * Журнал витрат AI (AI-5b, docs/ai-platform-controls.md §3.2, design.md R1/R6) проти
 * СПРАВЖНЬОГО Postgres: межа tenant-а (RLS), append-only для `saas_app` навіть після
 * повторного `db:roles`, тариф за датою виклику й заморожена оцінка, і журнал, що переживає
 * видалення розмов і ретенцію (немає FK на повідомлення).
 */
const tenantA = 'cost-ledger-a';
const tenantB = 'cost-ledger-b';
const MODEL = `ledger-model-${randomUUID()}`;

describe('AI cost ledger (e2e, real Postgres)', () => {
  let module: TestingModule;
  let system: SystemPrismaService;
  let tenantDb: PrismaService;
  let context: TenantContextService;
  let transactions: TenantTransactions;
  const ledger = new AiUsageLedger();

  beforeAll(async () => {
    // Ролі переналаштовуються ПІСЛЯ міграцій — той сценарій, у якому широкий GRANT колись
    // скасовував REVOKE міграцій (AI-5a). Журнал мусить лишитися append-only і після нього
    execSync(`pnpm --filter @saas-skeleton/database db:roles -- --db ${TEST_DB_NAME}`, {
      stdio: 'ignore',
    });
    module = await Test.createTestingModule({
      imports: [TenancyModule.forRoot(), PrismaModule, SystemPrismaModule],
    }).compile();
    await module.init();
    system = module.get(SystemPrismaService);
    tenantDb = module.get(PrismaService);
    context = module.get(TenantContextService);
    transactions = module.get(TenantTransactions);
    for (const id of [tenantA, tenantB]) {
      await system.tenant.upsert({
        where: { id },
        create: { id, slug: id, name: id },
        update: {},
      });
    }
  });

  beforeEach(async () => {
    await system.aiUsageEvent.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  });

  afterAll(async () => {
    await system.aiModelPrice.deleteMany({ where: { model: MODEL } });
    await system.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await module.close();
  });

  const inTenant = <T>(tenant: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    context.runWith(tenant, () => transactions.withTenantTx(fn));

  const entry = (overrides: Partial<UsageEntry> = {}): UsageEntry => ({
    kind: 'generation',
    outcome: 'complete',
    attempt: 1,
    messageId: randomUUID(),
    userId: randomUUID(),
    provider: 'manual-host.example',
    model: MODEL,
    tokens: {
      inputTokens: 1_000_000,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
      reasoningTokens: null,
    },
    reportedCost: null,
    requestId: null,
    ...overrides,
  });

  it('tenant B не бачить рядків tenant-а A і не може записати рядок від його імені', async () => {
    await inTenant(tenantA, (tx) => ledger.record(tx, [entry()]));

    expect(await inTenant(tenantA, (tx) => tx.aiUsageEvent.count())).toBe(1);
    expect(await inTenant(tenantB, (tx) => tx.aiUsageEvent.count())).toBe(0);
    await expect(
      inTenant(tenantB, (tx) =>
        tx.aiUsageEvent.create({
          data: {
            tenantId: tenantA,
            kind: 'generation',
            outcome: 'complete',
            provider: 'x',
            model: 'x',
            costStatus: 'unknown',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('saas_app не може UPDATE чи DELETE журналу навіть у своєму tenant-і (після db:roles)', async () => {
    await inTenant(tenantA, (tx) => ledger.record(tx, [entry()]));

    await expect(
      inTenant(tenantA, (tx) => tx.$executeRaw`UPDATE ai_usage_events SET outcome = 'failed'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inTenant(tenantA, (tx) => tx.$executeRaw`DELETE FROM ai_usage_events`),
    ).rejects.toThrow(/permission denied/);
    // Тарифи — control plane: tenant-процес лише читає
    await expect(
      tenantDb.$executeRaw`DELETE FROM ai_model_prices WHERE model = ${MODEL}`,
    ).rejects.toThrow(/permission denied/);
    expect(await system.aiUsageEvent.count({ where: { tenantId: tenantA } })).toBe(1);
  });

  it('тариф обирається за датою виклику, а оцінка заморожується в рядку', async () => {
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-06-01T00:00:00Z');
    const price = (validFrom: Date, input: string, output: string) =>
      system.aiModelPrice.create({
        data: {
          provider: 'manual-host.example',
          model: MODEL,
          inputPerMillion: new Prisma.Decimal(input),
          outputPerMillion: new Prisma.Decimal(output),
          validFrom,
          source: 'manual',
        },
      });
    const old = await price(t1, '1', '2');
    const current = await price(t2, '3', '4');

    await inTenant(tenantA, (tx) =>
      ledger.record(tx, [
        entry({ occurredAt: new Date('2025-12-31T23:59:59Z'), sourceId: 'before' }),
        entry({ occurredAt: new Date('2026-03-01T00:00:00Z'), sourceId: 'old' }),
        entry({ occurredAt: new Date('2026-07-01T00:00:00Z'), sourceId: 'current' }),
      ]),
    );
    // Ціна змінилась уже ПІСЛЯ всіх викликів — оцінки не переписуються
    await price(new Date('2026-08-01T00:00:00Z'), '100', '100');

    const rows = await inTenant(tenantA, (tx) =>
      tx.aiUsageEvent.findMany({ select: { sourceId: true, estimatedCost: true, priceId: true } }),
    );
    const bySource = new Map(rows.map((row) => [row.sourceId, row]));
    expect(bySource.get('before')).toMatchObject({ estimatedCost: null, priceId: null });
    expect(bySource.get('old')?.priceId).toBe(old.id);
    expect(bySource.get('old')?.estimatedCost?.toString()).toBe('3');
    expect(bySource.get('current')?.priceId).toBe(current.id);
    expect(bySource.get('current')?.estimatedCost?.toString()).toBe('7');
  });

  it('журнал переживає «видалити мої розмови» і нічну ретенцію', async () => {
    const user = await context.runWith(tenantA, () =>
      transactions.withTenantTx((tx) =>
        tx.user.create({
          data: { email: `ledger-${randomUUID()}@example.com`, passwordHash: 'x', name: 'L' },
        }),
      ),
    );
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const [fresh, stale] = await inTenant(tenantA, async (tx) => {
      const make = async (lastMessageAt: Date) => {
        const conversation = await tx.aiConversation.create({
          data: { userId: user.id, status: 'ACTIVE', lastMessageAt, createdAt: lastMessageAt },
        });
        await tx.aiConversation.update({
          where: { id: conversation.id },
          data: { status: 'RETIRED' },
        });
        const reply = await tx.aiMessage.create({
          data: {
            conversationId: conversation.id,
            seq: 1,
            role: 'ASSISTANT',
            status: 'COMPLETE',
            content: 'answer',
          },
        });
        return reply.id;
      };
      return [await make(new Date()), await make(longAgo)];
    });
    await inTenant(tenantA, (tx) =>
      ledger.record(tx, [
        entry({ messageId: fresh, userId: user.id }),
        entry({ messageId: stale, userId: user.id }),
      ]),
    );

    // Ретенція (AI-1e) — стара розмова зникає разом із повідомленнями
    await new AiPurgeConversationsSubscriber(system, loadAiConfig({})).handle();
    expect(await system.aiMessage.count({ where: { id: stale } })).toBe(0);
    // «Видалити мої розмови» — той самий deleteMany, що AiService.deleteAllConversations
    await inTenant(tenantA, (tx) => tx.aiConversation.deleteMany({ where: { userId: user.id } }));
    expect(await system.aiMessage.count({ where: { id: fresh } })).toBe(0);

    const left = await inTenant(tenantA, (tx) =>
      tx.aiUsageEvent.findMany({ where: { userId: user.id }, select: { messageId: true } }),
    );
    expect(left.map((row) => row.messageId).sort()).toEqual([fresh, stale].sort());
    await system.user.deleteMany({ where: { id: user.id } });
  });
});
