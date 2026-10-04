import { Prisma } from '@saas-skeleton/database';
import { describe, expect, it } from 'vitest';
import { parseGenerationRecord } from './openrouter-generation';
import { normalizeOpenRouterPricing, samePrice, syncOpenRouterPrices } from './openrouter-prices';
import { RECONCILE_MAX_ATTEMPTS, reconcilePendingUsage } from './reconcile';

const LUNA_PRICING = {
  prompt: '0.0000002',
  completion: '0.0000012',
  web_search: '0.01',
  input_cache_read: '0.00000002',
  input_cache_write: '0.00000025',
  overrides: [
    {
      min_prompt_tokens: 272_000,
      prompt: '0.0000004',
      completion: '0.0000018',
      input_cache_read: '0.00000004',
      input_cache_write: '0.0000005',
    },
  ],
};

describe('normalizeOpenRouterPricing (AI-5b)', () => {
  it('ціни за токен → за 1M, ступені з overrides', () => {
    const price = normalizeOpenRouterPricing('openai/gpt-5.6-luna', LUNA_PRICING);
    expect(price?.inputPerMillion.toString()).toBe('0.2');
    expect(price?.outputPerMillion.toString()).toBe('1.2');
    expect(price?.cacheReadPerMillion?.toString()).toBe('0.02');
    expect(price?.cacheWritePerMillion?.toString()).toBe('0.25');
    expect(price?.requestPrice.toString()).toBe('0');
    expect(price?.tiers).toEqual([
      {
        minPromptTokens: 272_000,
        inputPerMillion: '0.4',
        outputPerMillion: '1.8',
        cacheReadPerMillion: '0.04',
        cacheWritePerMillion: '0.5',
      },
    ]);
  });

  it('embedding без кешу: лише prompt/completion', () => {
    const price = normalizeOpenRouterPricing('openai/text-embedding-3-small', {
      prompt: '0.00000002',
      completion: '0',
    });
    expect(price?.inputPerMillion.toString()).toBe('0.02');
    expect(price?.cacheReadPerMillion).toBeNull();
    expect(price?.tiers).toBeNull();
  });

  it('роутер з ціною -1 чи зіпсована форма — пропуск, а не тариф', () => {
    expect(
      normalizeOpenRouterPricing('openrouter/auto', { prompt: '-1', completion: '-1' }),
    ).toBeNull();
    expect(normalizeOpenRouterPricing('x', { prompt: 'free' })).toBeNull();
    expect(normalizeOpenRouterPricing('x', null)).toBeNull();
  });

  it('samePrice: однакові ціни (інший запис числа) — та сама ціна; зміна ступеня — нова', () => {
    const next = normalizeOpenRouterPricing('m', LUNA_PRICING);
    if (!next) throw new Error('fixture');
    const stored = {
      inputPerMillion: new Prisma.Decimal('0.20000'),
      outputPerMillion: new Prisma.Decimal('1.2'),
      cacheReadPerMillion: new Prisma.Decimal('0.02'),
      cacheWritePerMillion: new Prisma.Decimal('0.25'),
      requestPrice: new Prisma.Decimal(0),
      tiers: next.tiers,
    };
    expect(samePrice(stored, next)).toBe(true);
    expect(samePrice({ ...stored, tiers: null }, next)).toBe(false);
    expect(samePrice({ ...stored, cacheReadPerMillion: null }, next)).toBe(false);
  });
});

describe('syncOpenRouterPrices (AI-5b, design.md R7)', () => {
  function fakeFetch(models: unknown, embeddings: unknown): typeof fetch {
    return ((url: string | URL) => {
      const body = String(url).endsWith('/embeddings/models') ? embeddings : models;
      if (body instanceof Error) {
        return Promise.reject(body);
      }
      return Promise.resolve(Response.json(body));
    }) as typeof fetch;
  }

  function store(latest: Record<string, unknown>[] = []): {
    created: Record<string, unknown>[];
    prisma: never;
  } {
    const created: Record<string, unknown>[] = [];
    return {
      created,
      prisma: {
        aiModelPrice: {
          findMany: () => Promise.resolve(latest),
          createMany: ({ data }: { data: Record<string, unknown>[] }) => {
            created.push(...data);
            return Promise.resolve({ count: data.length });
          },
        },
      } as never,
    };
  }

  it('новий рядок лише для нової чи зміненої ціни; збій одного списку не валить інший', async () => {
    const unchanged = normalizeOpenRouterPricing('openai/gpt-5.6-luna', LUNA_PRICING);
    const { created, prisma } = store([{ ...unchanged, provider: 'openrouter' }]);
    const result = await syncOpenRouterPrices(prisma, {
      fetch: fakeFetch(
        {
          data: [
            { id: 'openai/gpt-5.6-luna', pricing: LUNA_PRICING },
            { id: 'vendor/new', pricing: { prompt: '0.000001', completion: '0.000002' } },
            { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
          ],
        },
        new Error('boom'),
      ),
      now: new Date('2026-10-04T04:15:00Z'),
    });

    expect(result).toMatchObject({ created: 1, unchanged: 1, skipped: 1 });
    expect(result.errors).toEqual([
      { list: 'embeddings', message: 'OpenRouter embeddings list is unreachable' },
    ]);
    expect(created).toEqual([
      expect.objectContaining({
        provider: 'openrouter',
        model: 'vendor/new',
        source: 'openrouter-sync',
        validFrom: new Date('2026-10-04T04:15:00Z'),
      }),
    ]);
  });

  it('ручний тариф з іншою ціною на модель OpenRouter витісняється синхронізацією', async () => {
    const { created, prisma } = store([
      {
        provider: 'openrouter',
        model: 'vendor/new',
        source: 'manual',
        inputPerMillion: new Prisma.Decimal(5),
        outputPerMillion: new Prisma.Decimal(5),
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
        requestPrice: new Prisma.Decimal(0),
        tiers: null,
      },
    ]);
    await syncOpenRouterPrices(prisma, {
      fetch: fakeFetch(
        { data: [{ id: 'vendor/new', pricing: { prompt: '0.000001', completion: '0.000002' } }] },
        { data: [] },
      ),
    });
    expect(created).toHaveLength(1);
  });
});

describe('parseGenerationRecord (AI-5b)', () => {
  it('нативні токени й total_cost', () => {
    expect(
      parseGenerationRecord({
        data: {
          id: 'gen-1',
          model: 'openai/gpt-5.6-luna',
          total_cost: 0.00040496,
          tokens_prompt: 11_000,
          native_tokens_prompt: 11_181,
          native_tokens_completion: 118,
          native_tokens_cached: 10_988,
          native_tokens_reasoning: 0,
        },
      }),
    ).toEqual({
      status: 'found',
      cost: '0.00040496',
      model: 'openai/gpt-5.6-luna',
      tokens: {
        inputTokens: 11_181,
        cachedReadTokens: 10_988,
        cacheWriteTokens: null,
        outputTokens: 118,
        reasoningTokens: 0,
      },
    });
  });

  it('без вартості чи з неочікуваною формою — спробувати пізніше', () => {
    expect(parseGenerationRecord({ data: { id: 'gen-1' } })).toEqual({
      status: 'retry',
      reason: 'no-cost',
    });
    expect(parseGenerationRecord('nope').status).toBe('retry');
  });
});

describe('reconcilePendingUsage (AI-5b, design.md R5)', () => {
  function world(row: Record<string, unknown>): {
    row: Record<string, unknown>;
    prisma: never;
  } {
    const current = { ...row };
    return {
      row: current,
      prisma: {
        aiModelPrice: {
          findFirst: () =>
            Promise.resolve({
              id: 'price-1',
              inputPerMillion: new Prisma.Decimal('0.2'),
              outputPerMillion: new Prisma.Decimal('1.2'),
              cacheReadPerMillion: new Prisma.Decimal('0.02'),
              cacheWritePerMillion: null,
              requestPrice: new Prisma.Decimal(0),
              tiers: null,
            }),
        },
        aiUsageEvent: {
          findMany: () => Promise.resolve(current.costStatus === 'pending' ? [{ ...current }] : []),
          updateMany: ({
            where,
            data,
          }: {
            where: { costStatus: string };
            data: Record<string, unknown>;
          }) => {
            if (current.costStatus !== where.costStatus) return Promise.resolve({ count: 0 });
            Object.assign(current, data);
            return Promise.resolve({ count: 1 });
          },
        },
      } as never,
    };
  }

  const pending = {
    id: 'u-1',
    provider: 'openrouter',
    model: 'openai/gpt-5.6-luna',
    providerRequestId: 'gen-1',
    occurredAt: new Date('2026-10-04T10:00:00Z'),
    costStatus: 'pending',
    estimatedCost: null,
    priceId: null,
    reconcileAttempts: 0,
    reconcileAfter: new Date('2026-10-04T10:01:00Z'),
  };

  it('знайдено: reported, нативні токени, оцінка за тарифом на момент виклику', async () => {
    const { row, prisma } = world(pending);
    const result = await reconcilePendingUsage(prisma, () =>
      Promise.resolve({
        status: 'found',
        cost: '0.0003',
        model: null,
        tokens: {
          inputTokens: 1_000,
          cachedReadTokens: 0,
          cacheWriteTokens: null,
          outputTokens: 100,
          reasoningTokens: null,
        },
      }),
    );
    expect(result.reconciled).toBe(1);
    expect(row).toMatchObject({
      costStatus: 'reported',
      reportedCost: '0.0003',
      inputTokens: 1_000,
      outputTokens: 100,
      priceId: 'price-1',
      reconcileAfter: null,
    });
    expect(String(row.estimatedCost)).toBe('0.00032');
  });

  it('заморожена оцінка не переписується', async () => {
    const frozen = new Prisma.Decimal('0.123');
    const { row, prisma } = world({ ...pending, estimatedCost: frozen, priceId: 'old' });
    await reconcilePendingUsage(prisma, () =>
      Promise.resolve({
        status: 'found',
        cost: '0.1',
        model: null,
        tokens: {
          inputTokens: 1,
          cachedReadTokens: null,
          cacheWriteTokens: null,
          outputTokens: 1,
          reasoningTokens: null,
        },
      }),
    );
    expect(row.estimatedCost).toBe(frozen);
    expect(row.priceId).toBe('old');
  });

  it('не знайдено: backoff, після останньої спроби — unknown', async () => {
    const { row, prisma } = world(pending);
    const now = new Date('2026-10-04T10:02:00Z');
    await reconcilePendingUsage(
      prisma,
      () => Promise.resolve({ status: 'retry', reason: 'http-404' }),
      now,
    );
    expect(row).toMatchObject({ costStatus: 'pending', reconcileAttempts: 1 });
    expect((row.reconcileAfter as Date).getTime() - now.getTime()).toBe(5 * 60_000);

    Object.assign(row, { reconcileAttempts: RECONCILE_MAX_ATTEMPTS - 1 });
    await reconcilePendingUsage(
      prisma,
      () => Promise.resolve({ status: 'retry', reason: 'http-404' }),
      now,
      { warn: () => undefined },
    );
    expect(row).toMatchObject({ costStatus: 'unknown', reconcileAfter: null });
  });

  it('OpenRouter не налаштовано — спроба витрачається, рядок не висить вічно', async () => {
    const { row, prisma } = world(pending);
    await reconcilePendingUsage(prisma, null);
    expect(row.reconcileAttempts).toBe(1);
  });
});
