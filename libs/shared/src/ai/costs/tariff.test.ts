import { Prisma } from '@saas-skeleton/database';
import { describe, expect, it } from 'vitest';
import { billingProviderFor, reportsCost } from './billing';
import { costStatusFor, ledgerTokensFromLlm } from './usage-ledger';
import {
  cacheSavings,
  effectivePrices,
  estimateCost,
  parseTiers,
  perTokenToPerMillion,
  type TariffPrices,
} from './tariff';

const D = (value: string | number): Prisma.Decimal => new Prisma.Decimal(value);

/** openai/gpt-5.6-luna з живого списку OpenRouter 2026-10-04, переведений у $/1M */
const LUNA: TariffPrices = {
  inputPerMillion: D('0.2'),
  outputPerMillion: D('1.2'),
  cacheReadPerMillion: D('0.02'),
  cacheWritePerMillion: D('0.25'),
  requestPrice: D(0),
  tiers: [
    {
      minPromptTokens: 272_000,
      inputPerMillion: '0.4',
      outputPerMillion: '1.8',
      cacheReadPerMillion: '0.04',
      cacheWritePerMillion: '0.5',
    },
  ],
};

const tokens = (
  inputTokens: number | null,
  outputTokens: number | null,
  cachedReadTokens: number | null = null,
  cacheWriteTokens: number | null = null,
): Parameters<typeof estimateCost>[0] => ({
  inputTokens,
  outputTokens,
  cachedReadTokens,
  cacheWriteTokens,
});

describe('estimateCost (AI-5b)', () => {
  it('без кешу: input × ціна + output × ціна, точно до знака', () => {
    // 10 992 × 0.2/1M + 113 × 1.2/1M = 0.0021984 + 0.0001356
    expect(estimateCost(tokens(10_992, 113), LUNA)?.toString()).toBe('0.002334');
  });

  it('кеш читання й запису йдуть своїми цінами й віднімаються від input', () => {
    // (11 181 − 10 988 − 100) × 0.2 + 10 988 × 0.02 + 100 × 0.25 + 118 × 1.2, усе /1M
    // = 0.0000186 + 0.00021976 + 0.000025 + 0.0001416
    expect(estimateCost(tokens(11_181, 118, 10_988, 100), LUNA)?.toString()).toBe('0.00040496');
  });

  it('без окремої ціни кешу кешовані токени йдуть за ціною input', () => {
    const flat = { ...LUNA, cacheReadPerMillion: null, cacheWritePerMillion: null, tiers: null };
    expect(estimateCost(tokens(1_000, 0, 600, 100), flat)?.toString()).toBe('0.0002');
  });

  it('ступінь: від порогу токенів промпту діють ціни ступеня, нижче — базові', () => {
    expect(estimateCost(tokens(271_999, 0), LUNA)?.toString()).toBe('0.0543998');
    expect(estimateCost(tokens(272_000, 1_000), LUNA)?.toString()).toBe('0.1106');
  });

  it('обирається найвищий доречний ступінь, а відсутні в ньому ціни — базові', () => {
    const tiered = {
      ...LUNA,
      tiers: [
        { minPromptTokens: 100, inputPerMillion: '1' },
        { minPromptTokens: 1_000, inputPerMillion: '2' },
      ],
    };
    const prices = effectivePrices(tiered, 5_000);
    expect(prices.inputPerMillion.toString()).toBe('2');
    expect(prices.outputPerMillion.toString()).toBe('1.2');
  });

  it('ціна за запит додається зверху', () => {
    expect(estimateCost(tokens(0, 0), { ...LUNA, requestPrice: D('0.005') })?.toString()).toBe(
      '0.005',
    );
  });

  it('невідомі токени — null, а не нуль', () => {
    expect(estimateCost(tokens(null, 10), LUNA)).toBeNull();
    expect(estimateCost(tokens(10, null), LUNA)).toBeNull();
  });

  it('зіпсовані ступені не валять розрахунок — базові ціни', () => {
    expect(parseTiers([{ minPromptTokens: 'x' }])).toEqual([]);
    expect(estimateCost(tokens(1_000_000, 0), { ...LUNA, tiers: 'oops' })?.toString()).toBe('0.2');
  });

  it('економія кешу — кешовані токени × (input − cache read)', () => {
    expect(cacheSavings(tokens(11_000, 0, 10_000), LUNA).toString()).toBe('0.0018');
    expect(cacheSavings(tokens(11_000, 0, 0), LUNA).toString()).toBe('0');
  });

  it('ціна OpenRouter за токен → за 1M, без float', () => {
    expect(perTokenToPerMillion('0.00000002').toString()).toBe('0.02');
    expect(perTokenToPerMillion('0.0000000625').toString()).toBe('0.0625');
  });
});

describe('білінговий ключ і статус вартості (AI-5b)', () => {
  it('ключ провайдера з налаштувань', () => {
    expect(billingProviderFor('fake', null)).toBe('fake');
    expect(billingProviderFor('openai-compat', 'https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(billingProviderFor('openai-compat', 'https://api.deepseek.com/v1')).toBe(
      'api.deepseek.com',
    );
    expect(reportsCost('openrouter')).toBe(true);
    expect(reportsCost('api.deepseek.com')).toBe(false);
  });

  const usage = ledgerTokensFromLlm({ promptTokens: 1, completionTokens: 1 });

  it.each([
    ['openrouter', usage, '0.1', 'gen-1', 'reported'],
    ['openrouter', usage, null, 'gen-1', 'pending'],
    ['openrouter', null, null, 'gen-1', 'pending'],
    ['openrouter', null, null, null, 'unknown'],
    ['api.deepseek.com', usage, null, 'x', 'estimated'],
    ['api.deepseek.com', null, null, 'x', 'unknown'],
    ['fake', usage, '0', null, 'reported'],
  ] as const)('%s usage=%o cost=%s id=%s → %s', (provider, t, cost, id, expected) => {
    expect(costStatusFor({ provider, tokens: t, reportedCost: cost, requestId: id })).toBe(
      expected,
    );
  });
});
