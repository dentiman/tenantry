/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { AiMessageStateService } from '@saas-skeleton/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createTestUser, DEFAULT_TENANT_ID } from './test-users';

/**
 * `AiMessageStateService` проти СПРАВЖНЬОГО Postgres (AI-0.1, design.md D1/D3/D4).
 * HTTP-шар тут не потрібен: ці переходи — рівно те, на чому тримається виключна
 * власність генерації, і саме конкурентні транзакції, а не мокований Prisma,
 * підтверджують, що `WHERE`-умови справді взаємно виключні під конкурентним
 * навантаженням (design.md, «testable against FakeLlmProvider, deterministically»
 * стосується логіки воркера; ця гонка — властивість самого SQL).
 */
describe('AiMessageStateService (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let state: AiMessageStateService;
  let tenantTx: TenantTransactions;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    state = app.get(AiMessageStateService);
    tenantTx = app.get(TenantTransactions);
    tenantContext = app.get(TenantContextService);
  });

  beforeEach(async () => {
    await prisma.aiMessage.deleteMany();
    await prisma.aiConversation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Розмова + одна ASSISTANT-відповідь у заданому стані, напряму через SystemPrismaService */
  async function seedReply(overrides: {
    status: 'PENDING' | 'STREAMING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
    attempt?: number;
    leaseExpiresAt?: Date | null;
    content?: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    const user = await createTestUser(prisma, { email: `ai-state-${Date.now()}-${Math.random()}@example.com` });
    const conversation = await prisma.aiConversation.create({
      data: { tenantId: DEFAULT_TENANT_ID, userId: user.id, status: 'ACTIVE' },
    });
    const question = await prisma.aiMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        seq: 0,
        role: 'USER',
        status: 'COMPLETE',
        content: 'question',
      },
    });
    const reply = await prisma.aiMessage.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        seq: question.seq + 1,
        role: 'ASSISTANT',
        status: overrides.status,
        attempt: overrides.attempt ?? 0,
        leaseExpiresAt: overrides.leaseExpiresAt,
        content: overrides.content ?? '',
      },
    });
    return { conversationId: conversation.id, messageId: reply.id };
  }

  const claim = async (
    messageId: string,
    conversationId: string,
  ): ReturnType<AiMessageStateService['claim']> =>
    tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) =>
        state.claim(tx, messageId, conversationId, { leaseMs: 90_000, model: 'fake-1' }),
      ),
    );

  it('дві конкурентні спроби захопити ОДНУ PENDING-відповідь: рівно один переможець', async () => {
    const { conversationId, messageId } = await seedReply({ status: 'PENDING' });

    const [first, second] = await Promise.all([
      claim(messageId, conversationId),
      claim(messageId, conversationId),
    ]);

    const winners = [first, second].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.attempt).toBe(1);

    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.status).toBe('STREAMING');
    expect(row.attempt).toBe(1);
  });

  it('запис із застарілим attempt торкається 0 рядків (фенсинг)', async () => {
    const { conversationId, messageId } = await seedReply({ status: 'PENDING' });
    const claimed = await claim(messageId, conversationId);
    expect(claimed).not.toBeNull();

    const staleAttempt = (claimed?.attempt ?? 1) - 1; // застарілий номер спроби
    const stillOwned = await tenantContext.runWith(DEFAULT_TENANT_ID, () =>
      tenantTx.withTenantTx((tx) =>
        state.persistPartial(tx, messageId, staleAttempt, 'from a stale attempt', 1),
      ),
    );

    expect(stillOwned).toBe(false);
    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.content).toBe(''); // застарілий запис НЕ пройшов
  });

  it('STREAMING з простроченою орендою — захоплюваний, і отримує attempt + 1', async () => {
    const { conversationId, messageId } = await seedReply({
      status: 'STREAMING',
      attempt: 3,
      leaseExpiresAt: new Date(Date.now() - 1_000), // минула хвилину тому
      content: 'orphaned partial text',
    });

    const claimed = await claim(messageId, conversationId);

    expect(claimed).not.toBeNull();
    expect(claimed?.attempt).toBe(4);
    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.content).toBe(''); // покинута спроба скинута, а не дописана
  });

  it('STREAMING з ЖИВОЮ орендою — незахоплюваний', async () => {
    const { conversationId, messageId } = await seedReply({
      status: 'STREAMING',
      attempt: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000), // ще жива годину
    });

    const claimed = await claim(messageId, conversationId);
    expect(claimed).toBeNull();

    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.attempt).toBe(1); // не зачепили
  });

  it('термінальні статуси (COMPLETE/FAILED/CANCELLED) ніколи не захоплюються', async () => {
    for (const status of ['COMPLETE', 'FAILED', 'CANCELLED'] as const) {
      const { conversationId, messageId } = await seedReply({ status });
      expect(await claim(messageId, conversationId)).toBeNull();
    }
  });

  it('claim() НЕ скидає cancelRequestedAt — Stop на покинутій спробі переживає reclaim', async () => {
    // Попередня спроба впала, не встигнувши обробити Stop — рядок покинутий
    // (прострочена оренда) і несе живий cancelRequestedAt (design.md D4)
    const { conversationId, messageId } = await seedReply({
      status: 'STREAMING',
      attempt: 2,
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await prisma.aiMessage.update({
      where: { id: messageId },
      data: { cancelRequestedAt: new Date() },
    });

    const claimed = await claim(messageId, conversationId);

    expect(claimed).not.toBeNull();
    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.cancelRequestedAt).not.toBeNull(); // ГОЛОВНЕ: маркер пережив reclaim
  });

  it('cancelPending проти claim: рівно один перемагає, рядок лишається консистентним', async () => {
    const { conversationId, messageId } = await seedReply({ status: 'PENDING' });

    const cancel = async (): Promise<boolean> =>
      tenantContext.runWith(DEFAULT_TENANT_ID, () =>
        tenantTx.withTenantTx((tx) => state.cancelPending(tx, messageId)),
      );

    const [claimResult, cancelResult] = await Promise.all([
      claim(messageId, conversationId),
      cancel(),
    ]);

    const row = await prisma.aiMessage.findUniqueOrThrow({ where: { id: messageId } });
    if (claimResult !== null) {
      // claim переміг першим — CANCELLED більше не знаходить PENDING
      expect(cancelResult).toBe(false);
      expect(row.status).toBe('STREAMING');
    } else {
      // cancelPending переміг першим — claim більше не знаходить PENDING
      expect(cancelResult).toBe(true);
      expect(row.status).toBe('CANCELLED');
    }
    // У будь-якому разі рядок в ОДНОМУ несуперечливому кінцевому стані, ніколи не в обох
    expect(['STREAMING', 'CANCELLED']).toContain(row.status);
  });
});
