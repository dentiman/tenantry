/// <reference types="jest" />
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Prisma, SystemPrismaService } from '@saas-skeleton/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const OPERATOR_EMAIL = 'ai-costs-operator@example.com';
const OPERATOR_PASSWORD = 'OperatorPass123';
const tenantA = 'ai-costs-a';
const tenantB = 'ai-costs-b';
const MODEL = `costs-model-${randomUUID()}`;

/**
 * AI-5b: звітність суперадміна за журналом витрат і тарифи (docs/ai-platform-controls.md §3.5,
 * design.md R7/R8/R10). Підсумки мусять дорівнювати сумі рядків журналу періоду.
 */
describe('Platform AI costs and prices (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  let token: string;

  beforeAll(async () => {
    process.env.AI_SECRETS_KEY = randomBytes(32).toString('base64');
    process.env.AI_PROVIDER = 'fake';
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
    for (const [id, name] of [
      [tenantA, 'Alpha Costs'],
      [tenantB, 'Beta Costs'],
    ] as const) {
      await prisma.tenant.upsert({ where: { id }, create: { id, slug: id, name }, update: {} });
    }
  });

  beforeEach(async () => {
    await prisma.aiUsageEvent.deleteMany();
    await prisma.aiModelPrice.deleteMany({ where: { model: { startsWith: 'costs-model-' } } });
    await prisma.platformAiSettings.deleteMany();
    await prisma.platformUser.deleteMany();
    await prisma.platformUser.create({
      data: {
        email: OPERATOR_EMAIL,
        name: 'Costs Operator',
        passwordHash: await argon2.hash(OPERATOR_PASSWORD),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD })
      .expect(200);
    token = String((login.body as { accessToken: string }).accessToken);
  });

  afterAll(async () => {
    await prisma.aiUsageEvent.deleteMany();
    await prisma.aiModelPrice.deleteMany({ where: { model: { startsWith: 'costs-model-' } } });
    await prisma.platformAiSettings.deleteMany();
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await app.close();
    delete process.env.AI_SECRETS_KEY;
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };

  const event = (
    tenantId: string,
    data: Partial<Prisma.AiUsageEventUncheckedCreateInput>,
  ): Prisma.AiUsageEventUncheckedCreateInput => ({
    tenantId,
    occurredAt: new Date('2026-10-04T10:00:00Z'),
    kind: 'generation',
    outcome: 'complete',
    provider: 'openrouter',
    model: 'openai/gpt-5.6-luna',
    inputTokens: 1_000,
    cachedReadTokens: 0,
    outputTokens: 100,
    costStatus: 'reported',
    ...data,
  });

  async function seedLedger(): Promise<void> {
    const replyOk = randomUUID();
    const replyStopped = randomUUID();
    await prisma.aiUsageEvent.createMany({
      data: [
        // Відповідь 1 (A): ретрай + успіх + embedding питання = 0.0031
        event(tenantA, {
          messageId: replyOk,
          attempt: 1,
          outcome: 'retried',
          inputTokens: null,
          outputTokens: null,
          reportedCost: new Prisma.Decimal('0.001'),
        }),
        event(tenantA, {
          messageId: replyOk,
          attempt: 2,
          reportedCost: new Prisma.Decimal('0.002'),
          estimatedCost: new Prisma.Decimal('0.0019'),
        }),
        event(tenantA, {
          messageId: replyOk,
          kind: 'query_embedding',
          model: 'openai/text-embedding-3-small',
          inputTokens: 7,
          outputTokens: 0,
          reportedCost: new Prisma.Decimal('0.0001'),
        }),
        // Відповідь 2 (B): зупинена, вартість лише розрахункова
        event(tenantB, {
          messageId: replyStopped,
          attempt: 1,
          outcome: 'cancelled',
          occurredAt: new Date('2026-10-05T12:00:00Z'),
          costStatus: 'estimated',
          estimatedCost: new Prisma.Decimal('0.0005'),
        }),
        // Ingest (B), без відповіді
        event(tenantB, {
          kind: 'ingest_embedding',
          sourceId: 'fms/fms',
          model: 'openai/text-embedding-3-small',
          inputTokens: 50_000,
          outputTokens: 0,
          reportedCost: new Prisma.Decimal('0.001'),
        }),
        // Добір ще чекає — у підсумку грошей немає, але рядок рахується
        event(tenantA, { costStatus: 'pending', inputTokens: null, outputTokens: null }),
        // Поза періодом — не рахується
        event(tenantA, {
          occurredAt: new Date('2026-09-30T23:59:59Z'),
          reportedCost: new Prisma.Decimal('5'),
        }),
      ],
    });
  }

  it('без токена оператора — 401: звітність лише в control plane', async () => {
    await api().get('/api/ai/costs/summary').query(OCT).expect(401);
  });

  it('зведення за місяць = сума рядків журналу місяця', async () => {
    await seedLedger();
    const res = await api().get('/api/ai/costs/summary').query(OCT).set(auth()).expect(200);
    expect(res.body).toMatchObject({
      currency: 'USD',
      totals: {
        calls: 6,
        reportedCost: '0.0041',
        estimatedCost: '0.0024',
        cost: '0.0046',
        inputTokens: 52_007,
      },
      status: { reported: 4, estimated: 1, pending: 1, unknown: 0 },
      replies: {
        count: 2,
        completed: 1,
        averageCompletedCost: '0.0031',
        failedSpend: '0.0005',
        retriedSpend: '0.001',
      },
      reconciliation: {
        rows: 1,
        reportedCost: '0.002',
        estimatedCost: '0.0019',
        difference: '0.0001',
      },
    });
  });

  it('розрізи: tenant, kind і день у сумі дають те саме', async () => {
    await seedLedger();
    const by = async (dimension: string) =>
      (
        await api()
          .get('/api/ai/costs/breakdown')
          .query({ ...OCT, by: dimension })
          .set(auth())
          .expect(200)
      ).body as { items: { key: string; label: string; cost: string; calls: number }[] };

    const tenants = await by('tenant');
    expect(tenants.items).toEqual([
      expect.objectContaining({ key: tenantA, label: 'Alpha Costs', cost: '0.0031', calls: 4 }),
      expect.objectContaining({ key: tenantB, label: 'Beta Costs', cost: '0.0015', calls: 2 }),
    ]);
    const kinds = await by('kind');
    expect(kinds.items.map((i) => [i.key, i.cost])).toEqual([
      ['generation', '0.0035'],
      ['ingest_embedding', '0.001'],
      ['query_embedding', '0.0001'],
    ]);
    const days = await by('day');
    expect(days.items.map((i) => [i.key, i.cost])).toEqual([
      ['2026-10-04', '0.0041'],
      ['2026-10-05', '0.0005'],
    ]);
  });

  it('окремі рядки журналу: без токена — 401, найновіші перші, фільтри й пагінація', async () => {
    await api().get('/api/ai/costs/events').query(OCT).expect(401);

    await seedLedger();
    const list = async (query: Record<string, string | number>) =>
      (
        await api()
          .get('/api/ai/costs/events')
          .query({ ...OCT, ...query })
          .set(auth())
          .expect(200)
      ).body as {
        items: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };

    const all = await list({});
    expect(all).toMatchObject({ total: 6, page: 1, limit: 20, totalPages: 1 });
    expect(all.items).toHaveLength(6);
    // Найновіший рядок (05.10) — перший; оцінка без фактичної, cost — розрахункова
    expect(all.items[0]).toMatchObject({
      tenantId: tenantB,
      tenantLabel: 'Beta Costs',
      kind: 'generation',
      outcome: 'cancelled',
      costStatus: 'estimated',
      reportedCost: null,
      estimatedCost: '0.0005',
      cost: '0.0005',
    });

    const byTenant = await list({ tenantId: tenantB });
    expect(byTenant.total).toBe(2);
    expect(byTenant.items.every((i) => i.tenantId === tenantB)).toBe(true);

    const byKind = await list({ kind: 'ingest_embedding' });
    expect(byKind).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          sourceId: 'fms/fms',
          model: 'openai/text-embedding-3-small',
          inputTokens: 50_000,
          cost: '0.001',
          costStatus: 'reported',
        }),
      ],
    });

    const byStatus = await list({ costStatus: 'pending' });
    expect(byStatus).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ reportedCost: null, estimatedCost: null, cost: null })],
    });

    // Пошук за підрядком моделі — обидва embedding-рядки, різних tenant-ів
    const bySearch = await list({ search: 'text-embedding' });
    expect(bySearch.total).toBe(2);

    const page2 = await list({ limit: 1, page: 2 });
    expect(page2).toMatchObject({ total: 6, page: 2, limit: 1, totalPages: 6 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).not.toBe(all.items[0]?.id);
  });

  it('період довший за рік чи перевернутий — 400', async () => {
    await api()
      .get('/api/ai/costs/summary')
      .query({ from: OCT.to, to: OCT.from })
      .set(auth())
      .expect(400);
    await api()
      .get('/api/ai/costs/summary')
      .query({ from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })
      .set(auth())
      .expect(400);
  });

  it('ручний тариф: новий рядок, історія не переписується, список показує чинний', async () => {
    const create = (validFrom: string, input: string) =>
      api()
        .post('/api/ai/prices')
        .set(auth())
        .send({
          provider: 'API.DeepSeek.com',
          model: MODEL,
          inputPerMillion: input,
          outputPerMillion: '1.1',
          validFrom,
        })
        .expect(201);
    await create('2026-01-01T00:00:00.000Z', '0.27');
    const res = await create('2026-02-01T00:00:00.000Z', '0.28');
    expect(res.body).toMatchObject({
      provider: 'api.deepseek.com',
      inputPerMillion: '0.28',
      source: 'manual',
      createdBy: OPERATOR_EMAIL,
    });

    const list = await api().get('/api/ai/prices').query({ search: MODEL }).set(auth()).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ inputPerMillion: '0.28' }] });

    const history = await api()
      .get('/api/ai/prices/history')
      .query({ provider: 'api.deepseek.com', model: MODEL })
      .set(auth())
      .expect(200);
    expect(
      (history.body as { items: { inputPerMillion: string }[] }).items.map(
        (i) => i.inputPerMillion,
      ),
    ).toEqual(['0.28', '0.27']);

    await api()
      .post('/api/ai/prices')
      .set(auth())
      .send({ provider: 'x', model: MODEL, inputPerMillion: '-1', outputPerMillion: '1' })
      .expect(400);
  });

  it('модель без тарифу не активується для провайдера без вартості у відповіді', async () => {
    const put = () =>
      api().put('/api/ai/settings').set(auth()).send({
        enabled: true,
        provider: 'openai-compat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: MODEL,
        apiKey: 'sk-deepseek-e2e-key-1234',
      });
    const refused = await put().expect(400);
    expect(refused.body).toMatchObject({
      fieldErrors: [expect.objectContaining({ field: 'model', code: 'model_price_missing' })],
    });

    await prisma.aiModelPrice.create({
      data: {
        provider: 'api.deepseek.com',
        model: MODEL,
        inputPerMillion: new Prisma.Decimal('0.27'),
        outputPerMillion: new Prisma.Decimal('1.1'),
        validFrom: new Date(Date.now() - 1000),
        source: 'manual',
      },
    });
    await put().expect(200);
  });

  it('синхронізація OpenRouter: нові ціни, збій одного списку не валить інший', async () => {
    const model = `costs-model-or-${randomUUID()}`;
    const spy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/embeddings/models')) {
        return Promise.resolve(new Response('upstream down', { status: 503 }));
      }
      return Promise.resolve(
        Response.json({
          data: [{ id: model, pricing: { prompt: '0.0000002', completion: '0.0000012' } }],
        }),
      );
    });
    try {
      const first = await api().post('/api/ai/prices/sync').set(auth()).expect(200);
      expect(first.body).toMatchObject({
        created: 1,
        errors: [{ list: 'embeddings', message: 'OpenRouter embeddings list responded 503' }],
      });
      const second = await api().post('/api/ai/prices/sync').set(auth()).expect(200);
      expect(second.body).toMatchObject({ created: 0, unchanged: 1 });
    } finally {
      spy.mockRestore();
    }
    const stored = await prisma.aiModelPrice.findMany({ where: { model } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.inputPerMillion.toString()).toBe('0.2');
    expect(stored[0]?.source).toBe('openrouter-sync');
  });
});
