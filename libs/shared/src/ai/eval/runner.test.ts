import { Prisma } from '@saas-skeleton/database';
import { describe, expect, it } from 'vitest';
import type { TariffPrices } from '../costs/tariff';
import type { UsageEntry } from '../costs/usage-ledger';
import type { KnowledgeExcerpt } from '../knowledge/citations';
import { FakeLlmProvider } from '../llm/fake-llm.provider';
import {
  LlmProviderError,
  type LlmChunk,
  type LlmProvider,
  type LlmRequest,
} from '../llm/llm-provider';
import { buildGenerationRequest } from '../prompt/generation-request';
import { BudgetExceededError, BudgetGuard, MissingTariffError } from './budget';
import type { ResolvedEvalConfig } from './eval-config';
import type { EvalQuestion } from './question-set';
import { renderSummary, summarize, type RunMeta } from './report';
import {
  AnswerEvalRunner,
  estimateRun,
  historyRowsFromTurns,
  type AnswerEvalDeps,
  type AnswerEvalOptions,
} from './runner';

const D = (value: string | number): Prisma.Decimal => new Prisma.Decimal(value);

/** $1 / 1M input, $2 / 1M output */
const TARIFF: TariffPrices = {
  inputPerMillion: D(1),
  outputPerMillion: D(2),
  cacheReadPerMillion: null,
  cacheWritePerMillion: null,
  requestPrice: D(0),
  tiers: null,
};

const EXCERPTS: KnowledgeExcerpt[] = [
  {
    n: 1,
    chunkId: 'c1',
    documentId: 'd1',
    sourceKey: 'fms',
    revision: 'r1',
    title: 'Pricing',
    path: 'pricing.md',
    heading: 'Fees',
    contentHash: 'h'.repeat(64),
    content: 'The fee is 0.05 per conversation.',
  },
];

const QUESTIONS: EvalQuestion[] = [
  {
    id: 'q1',
    category: 'exact',
    language: 'en',
    role: 'ADMIN',
    question: 'What is the fee?',
    expected: ['pricing.md'],
    turns: [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
    ],
  },
  {
    id: 'q2',
    category: 'none',
    language: 'en',
    role: 'USER',
    question: 'What is the CEO salary?',
    expected: [],
  },
];

function config(name: string, overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
  return {
    name,
    model: 'm-1',
    maxOutputTokens: 100,
    historyTurns: 10,
    finalChunks: 5,
    maxContextTokens: 1000,
    searchMode: 'hybrid',
    maxDistance: 0.8,
    overridden: [],
    ...overrides,
  };
}

/** Провайдер-сценарій: кожен виклик — наступний крок зі списку (останній повторюється) */
class ScriptedProvider implements LlmProvider {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: readonly (LlmChunk[] | Error)[]) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- генератор-сценарій без очікувань
  async *generate(request: LlmRequest): AsyncIterable<LlmChunk> {
    const step = this.script[Math.min(this.requests.length, this.script.length - 1)] ?? [];
    this.requests.push(request);
    if (step instanceof Error) throw step;
    yield* step;
  }
}

const reply = (text: string, cost = '0.001'): LlmChunk[] => [
  { text: '', requestId: 'gen-1' },
  { text },
  {
    text: '',
    usage: { promptTokens: 1000, completionTokens: 50, model: 'm-1-2026', reportedCost: cost },
    finishReason: 'stop',
  },
];

function harness(
  generator: LlmProvider,
  opts: {
    judge?: LlmProvider;
    billing?: string;
    limit?: string | null;
    configs?: ResolvedEvalConfig[];
    tariffs?: boolean;
    embeddingCost?: string;
  } = {},
): {
  deps: AnswerEvalDeps;
  options: AnswerEvalOptions;
  entries: UsageEntry[];
  retrieveCalls: string[];
} {
  const entries: UsageEntry[] = [];
  const retrieveCalls: string[] = [];
  const seen = new Set<string>();
  const billing = opts.billing ?? 'openrouter';
  const deps: AnswerEvalDeps = {
    retrieve: (cfg, question) => {
      retrieveCalls.push(`${cfg.name}:${question.id}`);
      const fresh = !seen.has(question.question);
      seen.add(question.question);
      return Promise.resolve({
        selection: { version: 'v', documents: [], excerpts: EXCERPTS },
        degraded: false,
        embedding:
          cfg.searchMode === 'fts'
            ? null
            : {
                usage: {
                  inputTokens: 10,
                  billing: {
                    provider: billing,
                    model: 'openai/text-embedding-3-small',
                    reportedCost: opts.embeddingCost ?? '0.0001',
                    requestId: 'emb',
                  },
                },
                fresh,
              },
      });
    },
    generator: { provider: generator, billing },
    judge: opts.judge ? { provider: opts.judge, billing, model: 'judge-1' } : null,
    record: (rows) => {
      entries.push(...rows);
      return Promise.resolve();
    },
    findTariff: () => Promise.resolve(opts.tariffs === false ? null : TARIFF),
    sleep: () => Promise.resolve(),
    now: () => 0,
  };
  const options: AnswerEvalOptions = {
    runId: 'run1',
    questions: QUESTIONS,
    configs: opts.configs ?? [config('a'), config('b', { historyTurns: 0 })],
    repeats: 1,
    locale: 'en',
    organization: { persona: 'Friendly', instructions: '' },
    limits: { requestTimeoutMs: 5_000, providerRetries: 1, retryDelayMs: 1 },
    budget: new BudgetGuard(opts.limit === null ? null : D(opts.limit ?? '10')),
  };
  return { deps, options, entries, retrieveCalls };
}

describe('AnswerEvalRunner', () => {
  it('промпт — той самий buildGenerationRequest, що у воркера; порядок питання → конфігурація', async () => {
    const generator = new ScriptedProvider([reply('The fee is 0.05 [1].')]);
    const { deps, options, retrieveCalls } = harness(generator);
    const result = await new AnswerEvalRunner(deps, options).run();

    expect(result.records.map((r) => `${r.questionId}:${r.config}`)).toEqual([
      'q1:a',
      'q1:b',
      'q2:a',
      'q2:b',
    ]);
    expect(generator.requests[0]).toEqual(
      buildGenerationRequest({
        question: 'What is the fee?',
        historyRows: historyRowsFromTurns(QUESTIONS[0]?.turns),
        historyTurns: 10,
        user: { role: 'ADMIN', locale: 'en' },
        organization: options.organization,
        knowledge: { documents: [], excerpts: EXCERPTS },
        model: 'm-1',
        maxOutputTokens: 100,
      }),
    );
    // historyTurns 0 у конфігурації b: попередніх реплік у промпті немає
    expect(generator.requests[1]?.messages.some((m) => m.content === 'old answer')).toBe(false);
    expect(generator.requests[0]?.messages.some((m) => m.content === 'old answer')).toBe(true);
    expect(generator.requests[0]).not.toHaveProperty('temperature');
    // Однакові параметри пошуку — один пошук на питання
    expect(retrieveCalls).toEqual(['a:q1', 'a:q2']);

    const [first] = result.records;
    expect(first?.checks).toMatchObject({
      answered: true,
      citationHit: true,
      numbersGrounded: true,
    });
    expect(result.records[2]?.refusalOk).toBe(false); // питання без відповіді процитовано
  });

  it('журнал: kind eval, без user/message, source_id за конфігурацією; embedding — у ціні кожної відповіді, у витратах — раз', async () => {
    const { deps, options, entries } = harness(new ScriptedProvider([reply('Fee [1].', '0.001')]));
    const result = await new AnswerEvalRunner(deps, options).run();

    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.kind === 'eval' && e.messageId === undefined)).toBe(true);
    expect(entries.map((e) => e.sourceId)).toEqual([
      'answers-eval:run1:a',
      'answers-eval:run1:b',
      'answers-eval:run1:a',
      'answers-eval:run1:b',
    ]);
    expect(entries[0]).toMatchObject({
      outcome: 'complete',
      attempt: 1,
      model: 'm-1-2026',
      requestedModel: 'm-1',
      reportedCost: '0.001',
      requestId: 'gen-1',
    });
    // Ціна відповіді як у проді: 0.001 + 0.0001 для КОЖНОЇ відповіді
    expect(result.records.map((r) => r.cost.answer.value?.toFixed())).toEqual([
      '0.0011',
      '0.0011',
      '0.0011',
      '0.0011',
    ]);
    // Фактично: 4 генерації + 2 справжні embedding-и
    expect(result.spentAnswers.toFixed()).toBe('0.0042');
  });

  it('ретрай-придатна помилка: рядок retried, друга спроба complete; не ретрай-придатна — failed', async () => {
    const retry = harness(new ScriptedProvider([new LlmProviderError('busy'), reply('Fee [1].')]), {
      configs: [config('a')],
    });
    retry.options = { ...retry.options, questions: QUESTIONS.slice(0, 1) };
    const ok = await new AnswerEvalRunner(retry.deps, retry.options).run();
    expect(retry.entries.map((e) => [e.outcome, e.attempt])).toEqual([
      ['retried', 1],
      ['complete', 2],
    ]);
    expect(ok.records[0]?.attempts).toBe(2);
    expect(ok.records[0]?.error).toBeNull();

    const reject = harness(
      new ScriptedProvider([new LlmProviderError('bad', { retryable: false })]),
      { configs: [config('a')] },
    );
    reject.options = { ...reject.options, questions: QUESTIONS.slice(0, 1) };
    const failed = await new AnswerEvalRunner(reject.deps, reject.options).run();
    expect(reject.entries.map((e) => e.outcome)).toEqual(['failed']);
    expect(failed.records[0]).toMatchObject({ error: 'provider', checks: null });
  });

  it('суддя: валідний JSON — оцінка; невалідний — judge_error; вартість судді окремо', async () => {
    const verdict = { grounded: 5, answers_question: 4, refusal_correct: true, note: 'ok' };
    const judge = new ScriptedProvider([
      reply(JSON.stringify(verdict), '0.01'),
      reply('not json', '0.01'),
    ]);
    const { deps, options, entries } = harness(new ScriptedProvider([reply('Fee [1].')]), {
      judge,
      configs: [config('a')],
    });
    const result = await new AnswerEvalRunner(deps, options).run();

    expect(result.records[0]?.judge).toMatchObject({ verdict, error: null });
    expect(result.records[1]?.judge).toMatchObject({ verdict: null, error: 'invalid-json' });
    expect(judge.requests[0]).toMatchObject({ model: 'judge-1', temperature: 0 });
    expect(entries.filter((e) => e.sourceId === 'answers-eval:run1:judge')).toHaveLength(2);
    expect(result.spentJudge.toFixed()).toBe('0.02');
    expect(result.spentAnswers.toFixed()).toBe('0.0022');
  });

  it('бюджет до старту: модель без тарифу — відмова з назвою моделі; оцінка понад ліміт — відмова без викликів', async () => {
    const generator = new ScriptedProvider([reply('x')]);
    const noTariff = harness(generator, { tariffs: false });
    await expect(estimateRun(noTariff.options, noTariff.deps)).rejects.toThrow(MissingTariffError);
    await expect(estimateRun(noTariff.options, noTariff.deps)).rejects.toThrow(/m-1.*Sync/s);

    const { deps, options } = harness(generator, { limit: '0.0001' });
    const estimate = await estimateRun(options, deps);
    // 2 питання × 2 конфігурації: вхід ≥ maxContextTokens, вихід = maxOutputTokens
    expect(estimate.total.gt(D('0.0001'))).toBe(true);
    expect(() => {
      options.budget.assertEstimate(estimate.total);
    }).toThrow(BudgetExceededError);
    expect(generator.requests).toHaveLength(0);
  });

  it('fake — тариф не потрібен, оцінка 0', async () => {
    const { deps, options } = harness(new FakeLlmProvider({ chunkDelayMs: 0 }), {
      billing: 'fake',
      tariffs: false,
      limit: null,
    });
    expect((await estimateRun(options, deps)).total.toFixed()).toBe('0');
  });

  it('живий запобіжник: перетин ліміту зупиняє прогін, частковий звіт пишеться', async () => {
    const generator = new ScriptedProvider([reply('Fee [1].', '0.003')]);
    const { deps, options } = harness(generator, { limit: '0.005' });
    const result = await new AnswerEvalRunner(deps, options).run();

    expect(result.stopped).toBe('budget');
    expect(result.records).toHaveLength(2); // 0.0031 + 0.0030 ≥ 0.005 — далі нічого не викликаємо
    expect(generator.requests).toHaveLength(2);

    const summaries = summarize(result, options.configs, 1);
    const meta: RunMeta = {
      runId: 'run1',
      startedAt: 's',
      finishedAt: 'f',
      tenant: 'default',
      questionSet: { path: 'set.json', product: 'fms' },
      questions: 2,
      repeats: 1,
      locale: 'en',
      organizationInstructions: true,
      generationProvider: 'openrouter',
      judge: null,
      maxCost: '0.005',
      estimate: '0.01',
      stopped: result.stopped,
      spent: { answers: '0.0061', judge: '0', total: '0.0061' },
      ledgerTotal: '0.0061',
      unknownCostCalls: 0,
      warnings: [],
    };
    const summary = renderSummary(meta, options.configs, summaries);
    expect(summary).toContain('stopped: budget');
    expect(summary).toContain('| a | 100% |');
  });

  it('FakeLlmProvider проходить увесь шлях без мережі й тарифу: вартість 0, рядки журналу є', async () => {
    const { deps, options, entries } = harness(new FakeLlmProvider({ chunkDelayMs: 0 }), {
      billing: 'fake',
      tariffs: false,
      limit: null,
      embeddingCost: '0',
      configs: [config('a', { searchMode: 'fts' })],
    });
    const result = await new AnswerEvalRunner(deps, options).run();
    expect(result.records).toHaveLength(2);
    expect(result.records.every((r) => r.error === null)).toBe(true);
    expect(result.records[0]?.cost.embedding).toBeNull(); // fts — без embedding
    expect(result.spentAnswers.toFixed()).toBe('0');
    expect(entries.map((e) => e.provider)).toEqual(['fake', 'fake']);
  });
});
