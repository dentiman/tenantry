import { Prisma } from '@saas-skeleton/database';
import { FAKE_BILLING } from '../costs/billing';
import { estimateCost, type TariffPrices } from '../costs/tariff';
import {
  ledgerTokensFromLlm,
  type LedgerTokens,
  type UsageEntry,
  type UsageOutcome,
} from '../costs/usage-ledger';
import type { KnowledgeExcerpt } from '../knowledge/citations';
import type { KnowledgeSelection, QueryEmbeddingUsage } from '../knowledge/knowledge-source';
import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage,
} from '../llm/llm-provider';
import { buildGenerationRequest } from '../prompt/generation-request';
import type { AiHistoryRow } from '../prompt/history';
import type { AiOrganizationInstructions } from '../prompt/organization-instructions';
import {
  BudgetGuard,
  callCost,
  generationEstimate,
  judgeEstimate,
  requireTariff,
  type CallEstimate,
} from './budget';
import { checkAnswer, type AnswerChecks } from './checks';
import { retrievalKey, type ResolvedEvalConfig } from './eval-config';
import {
  buildJudgeRequest,
  parseJudgeOutput,
  type JudgeErrorCode,
  type JudgeVerdict,
} from './judge';
import { isAnswerable, type EvalQuestion, type QuestionTurn } from './question-set';

/**
 * Раннер eval відповідей (AI-5c, design.md D1–D9, I1–I10). Залежності інжектуються: CLI
 * підставляє БД/провайдери, юніт-тест — фейки, без БД і мережі.
 *
 * Правила, що тримаються тут:
 * - запит до моделі будує `buildGenerationRequest` — та сама функція, що у воркері;
 * - провайдер НІКОЛИ не викликається в транзакції: рядок журналу пишеться ПІСЛЯ виклику,
 *   власною короткою транзакцією (`deps.record`);
 * - нічого, крім журналу (`kind = eval`), не пишеться; квота не списується;
 * - гроші — `Prisma.Decimal`, назовні — десяткові рядки.
 */

type Decimal = Prisma.Decimal;

export type CostStatus = 'reported' | 'estimated' | 'unknown';

export interface CallCost {
  readonly value: Decimal | null;
  readonly status: CostStatus;
}

export interface EvalRetrieval {
  readonly selection: KnowledgeSelection;
  readonly degraded: boolean;
  /** Embedding питання (немає у `fts`); `fresh` — справжній виклик у цьому прогоні, не кеш */
  readonly embedding: { readonly usage: QueryEmbeddingUsage; readonly fresh: boolean } | null;
}

export interface AnswerEvalDeps {
  /** Пошук тими самими `PostgresKnowledgeSource` + `selectionFromRetrieval`, що й воркер */
  retrieve(config: ResolvedEvalConfig, question: EvalQuestion): Promise<EvalRetrieval>;
  readonly generator: { readonly provider: LlmProvider; readonly billing: string };
  readonly judge: {
    readonly provider: LlmProvider;
    readonly billing: string;
    readonly model: string;
  } | null;
  /** Рядки журналу — власна коротка tenant-транзакція ПІСЛЯ виклику провайдера */
  record(entries: readonly UsageEntry[]): Promise<void>;
  findTariff(provider: string, model: string): Promise<TariffPrices | null>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  log?(line: string): void;
}

export interface AnswerEvalOptions {
  readonly runId: string;
  readonly questions: readonly EvalQuestion[];
  readonly configs: readonly ResolvedEvalConfig[];
  readonly repeats: number;
  readonly locale: string;
  readonly organization: AiOrganizationInstructions;
  readonly limits: {
    readonly requestTimeoutMs: number;
    readonly providerRetries: number;
    readonly retryDelayMs: number;
  };
  readonly budget: BudgetGuard;
  /** SIGINT/SIGTERM: зупинитись між викликами й записати частковий звіт */
  readonly signal?: AbortSignal;
  /** Прогрес для термінала: викликається після кожної відповіді */
  readonly onAnswer?: (record: AnswerRecord, done: number, total: number) => void;
}

export interface JudgeOutcome {
  readonly verdict: JudgeVerdict | null;
  readonly error: JudgeErrorCode | null;
  readonly cost: CallCost;
}

export interface AnswerRecord {
  readonly repeat: number;
  readonly config: string;
  readonly questionId: string;
  readonly category: string;
  readonly language: string;
  readonly answerable: boolean;
  readonly answer: string;
  /** `knowledge` — пошук упав; `provider` / `timeout` / `internal` — генерація */
  readonly error: string | null;
  readonly excerpts: readonly { n: number; path: string; heading: string }[];
  readonly degraded: boolean;
  readonly checks: AnswerChecks | null;
  /** Відмова з урахуванням судді: проксі (без цитат) І `refusal_correct`, якщо суддя відповів */
  readonly refusalOk: boolean | null;
  readonly judge: JudgeOutcome | null;
  readonly model: string | null;
  readonly usage: LlmUsage | null;
  readonly finishReason: string | null;
  readonly attempts: number;
  readonly latencyMs: number;
  /** Ціна відповіді як у проді: усі спроби генерації + embedding питання (навіть із кешу) */
  readonly cost: {
    readonly generation: CallCost;
    readonly embedding: CallCost | null;
    readonly answer: CallCost;
  };
}

export type StopReason = 'budget' | 'interrupted' | null;

export interface AnswerEvalResult {
  readonly records: AnswerRecord[];
  readonly stopped: StopReason;
  /** Фактично витрачено прогоном (embedding — раз), без судді */
  readonly spentAnswers: Decimal;
  readonly spentJudge: Decimal;
  /** Скільки викликів прогону лишилось без вартості (ні суми провайдера, ні тарифу) */
  readonly unknownCostCalls: number;
}

export interface RunEstimate {
  readonly total: Decimal;
  readonly perConfig: ReadonlyMap<string, { generation: CallEstimate; cost: Decimal }>;
  readonly judge: Decimal;
}

const ZERO = new Prisma.Decimal(0);

/** `turns` набору → рядки розмови в порядку `seq`, як їх читає воркер (усі завершені) */
export function historyRowsFromTurns(turns: readonly QuestionTurn[] | undefined): AiHistoryRow[] {
  return (turns ?? []).map((turn, i) => ({
    seq: i + 1,
    role: turn.role === 'user' ? 'USER' : 'ASSISTANT',
    status: 'COMPLETE',
    content: turn.content,
  }));
}

function requestFor(
  config: ResolvedEvalConfig,
  question: EvalQuestion,
  options: Pick<AnswerEvalOptions, 'locale' | 'organization'>,
  knowledge: Pick<KnowledgeSelection, 'documents' | 'excerpts'>,
): LlmRequest {
  return buildGenerationRequest({
    question: question.question,
    historyRows: historyRowsFromTurns(question.turns),
    historyTurns: config.historyTurns,
    user: { role: question.role, locale: options.locale },
    organization: options.organization,
    knowledge,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
  });
}

/**
 * Оцінка прогону ДО старту (design.md I8): верхня межа за тарифами на зараз. Модель без
 * тарифу — `MissingTariffError`; `fake` — 0. Embedding питання не входить: копійки
 * (десятки токенів на питання) і білінг embeddings відомий лише після першого виклику.
 */
export async function estimateRun(
  options: Pick<AnswerEvalOptions, 'questions' | 'configs' | 'repeats' | 'locale' | 'organization'>,
  deps: Pick<AnswerEvalDeps, 'generator' | 'judge' | 'findTariff'>,
): Promise<RunEstimate> {
  const judgeTariff = deps.judge
    ? await requireTariff(deps.judge.billing, deps.judge.model, (p, m) => deps.findTariff(p, m))
    : null;
  const perConfig = new Map<string, { generation: CallEstimate; cost: Decimal }>();
  let total = ZERO;
  let judge = ZERO;
  for (const config of options.configs) {
    const tariff = await requireTariff(deps.generator.billing, config.model, (p, m) =>
      deps.findTariff(p, m),
    );
    let configCost = ZERO;
    let largest: CallEstimate = { inputTokens: 0, outputTokens: config.maxOutputTokens };
    for (const question of options.questions) {
      const estimate = generationEstimate(
        requestFor(config, question, options, { documents: [] }).messages,
        config.maxContextTokens,
        config.maxOutputTokens,
      );
      if (estimate.inputTokens > largest.inputTokens) largest = estimate;
      if (tariff) configCost = configCost.add(callCost(estimate, tariff));
      if (deps.judge && judgeTariff) {
        judge = judge.add(callCost(judgeEstimate(estimate), judgeTariff));
      }
    }
    configCost = configCost.mul(options.repeats);
    perConfig.set(config.name, {
      generation: largest,
      cost: tariff ? callCost(largest, tariff) : ZERO,
    });
    total = total.add(configCost);
  }
  judge = judge.mul(options.repeats);
  return { total: total.add(judge), perConfig, judge };
}

interface AttemptResult {
  readonly text: string;
  readonly usage: LlmUsage | null;
  readonly requestId: string | null;
  readonly finishReason: string | null;
  readonly error: unknown;
  readonly timedOut: boolean;
}

async function generateOnce(
  provider: LlmProvider,
  request: LlmRequest,
  timeoutMs: number,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort('timeout');
  }, timeoutMs);
  let text = '';
  let usage: LlmUsage | null = null;
  let requestId: string | null = null;
  let finishReason: string | null = null;
  let error: unknown = null;
  try {
    for await (const chunk of provider.generate(request, controller.signal)) {
      text += chunk.text;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.requestId && requestId === null) requestId = chunk.requestId;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }
  } catch (caught) {
    error = caught;
  } finally {
    clearTimeout(timer);
  }
  return { text, usage, requestId, finishReason, error, timedOut: controller.signal.aborted };
}

export class AnswerEvalRunner {
  private readonly retrievals = new Map<string, Promise<EvalRetrieval>>();
  private spentAnswers = ZERO;
  private spentJudge = ZERO;
  private unknownCostCalls = 0;

  constructor(
    private readonly deps: AnswerEvalDeps,
    private readonly options: AnswerEvalOptions,
    /** Оцінка до старту — запасна вартість виклику, для якого невідомо нічого */
    private readonly estimate: RunEstimate | null = null,
  ) {}

  async run(): Promise<AnswerEvalResult> {
    const records: AnswerRecord[] = [];
    let stopped: StopReason = null;
    const total =
      this.options.repeats * this.options.questions.length * this.options.configs.length;
    // Порядок repeat → питання → конфігурація (design.md I8): зупинка лишає порівнянні дані
    outer: for (let repeat = 1; repeat <= this.options.repeats; repeat += 1) {
      for (const question of this.options.questions) {
        for (const config of this.options.configs) {
          stopped = this.stopReason();
          if (stopped) break outer;
          const record = await this.answer(repeat, question, config);
          records.push(record);
          this.options.onAnswer?.(record, records.length, total);
        }
      }
    }
    stopped ??= this.stopReason();
    return {
      records,
      stopped,
      spentAnswers: this.spentAnswers,
      spentJudge: this.spentJudge,
      unknownCostCalls: this.unknownCostCalls,
    };
  }

  private stopReason(): StopReason {
    if (this.options.signal?.aborted) return 'interrupted';
    return this.options.budget.exceeded ? 'budget' : null;
  }

  private sourceId(part: string): string {
    return `answers-eval:${this.options.runId}:${part}`;
  }

  /** Пошук кешується на (параметри пошуку, питання): повтори й однакові конфігурації — без виклику */
  private retrieve(config: ResolvedEvalConfig, question: EvalQuestion): Promise<EvalRetrieval> {
    const key = `${retrievalKey(config)}\u0000${question.id}`;
    const cached = this.retrievals.get(key);
    if (cached) {
      return cached.then((r) => ({
        ...r,
        embedding: r.embedding ? { ...r.embedding, fresh: false } : null,
      }));
    }
    const fresh = this.deps.retrieve(config, question);
    this.retrievals.set(key, fresh);
    // Збій пошуку не кешується: наступна конфігурація чи повтор спробує знову
    fresh.catch(() => this.retrievals.delete(key));
    return fresh;
  }

  private async answer(
    repeat: number,
    question: EvalQuestion,
    config: ResolvedEvalConfig,
  ): Promise<AnswerRecord> {
    const base = {
      repeat,
      config: config.name,
      questionId: question.id,
      category: question.category,
      language: question.language,
      answerable: isAnswerable(question),
    };
    let retrieval: EvalRetrieval;
    try {
      retrieval = await this.retrieve(config, question);
    } catch (error) {
      this.deps.log?.(
        `${question.id} × ${config.name}: knowledge selection failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      // Провайдера генерації не викликали — відповідь без вартості, у середні вона не йде
      const none: CallCost = { value: ZERO, status: 'reported' };
      return {
        ...base,
        answer: '',
        error: 'knowledge',
        excerpts: [],
        degraded: false,
        checks: null,
        refusalOk: null,
        judge: null,
        model: null,
        usage: null,
        finishReason: null,
        attempts: 0,
        latencyMs: 0,
        cost: { generation: none, embedding: null, answer: none },
      };
    }

    const embedding = retrieval.embedding ? await this.embeddingCost(retrieval.embedding) : null;
    const excerpts: readonly KnowledgeExcerpt[] = retrieval.selection.excerpts ?? [];
    const request = requestFor(config, question, this.options, retrieval.selection);
    const generation = await this.generate(config, request);

    const answer = generation.last.text;
    const failed = generation.last.error !== null || generation.last.timedOut;
    const checks = failed
      ? null
      : checkAnswer({
          question,
          answer,
          excerpts,
          finishReason: generation.last.finishReason,
          completionTokens: generation.last.usage?.completionTokens ?? null,
          maxOutputTokens: config.maxOutputTokens,
        });
    const judge =
      !failed && this.deps.judge && answer.trim() !== '' && !this.stopReason()
        ? await this.runJudge(question, excerpts, answer)
        : null;
    const proxyRefusal = checks?.refusalOk ?? null;
    const refusalOk =
      proxyRefusal === null ? null : proxyRefusal && (judge?.verdict?.refusal_correct ?? true);

    return {
      ...base,
      answer,
      error: failed ? failureCode(generation.last) : null,
      excerpts: excerpts.map(({ n, path, heading }) => ({ n, path, heading })),
      degraded: retrieval.degraded,
      checks,
      refusalOk,
      judge,
      model: generation.last.usage?.model ?? config.model,
      usage: generation.last.usage,
      finishReason: generation.last.finishReason,
      attempts: generation.attempts,
      latencyMs: generation.latencyMs,
      cost: {
        generation: generation.cost,
        embedding,
        answer: sumCosts([generation.cost, ...(embedding ? [embedding] : [])]),
      },
    };
  }

  /** Спроби як у воркері: ретрай лише ретрай-придатної помилки, у межах бюджету й Retry-After */
  private async generate(
    config: ResolvedEvalConfig,
    request: LlmRequest,
  ): Promise<{ last: AttemptResult; attempts: number; cost: CallCost; latencyMs: number }> {
    const { requestTimeoutMs, providerRetries, retryDelayMs } = this.options.limits;
    const startedAt = this.deps.now();
    const costs: CallCost[] = [];
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const result = await generateOnce(this.deps.generator.provider, request, requestTimeoutMs);
      const failed = result.error !== null || result.timedOut;
      const error = result.error;
      const retryable = !result.timedOut && error instanceof LlmProviderError && error.retryable;
      const waitFits =
        !(error instanceof LlmProviderError) ||
        error.retryAfterMs === undefined ||
        error.retryAfterMs <= retryDelayMs;
      const retry = failed && retryable && attempt <= providerRetries && waitFits;
      const outcome: UsageOutcome = !failed
        ? 'complete'
        : retry
          ? 'retried'
          : result.timedOut
            ? 'timeout'
            : 'failed';
      const cost = await this.recordCall(
        {
          kind: 'eval',
          outcome,
          sourceId: this.sourceId(config.name),
          attempt,
          provider: this.deps.generator.billing,
          model: result.usage?.model ?? request.model,
          requestedModel: request.model,
          tokens: ledgerTokensFromLlm(result.usage),
          reportedCost: result.usage?.reportedCost ?? null,
          requestId: result.requestId,
        },
        this.estimate?.perConfig.get(config.name)?.cost ?? null,
      );
      costs.push(cost);
      this.spentAnswers = this.spentAnswers.add(cost.value ?? ZERO);
      if (retry && !this.stopReason()) {
        await this.deps.sleep(retryDelayMs, this.options.signal ?? new AbortController().signal);
        continue;
      }
      return {
        last: result,
        attempts: attempt,
        cost: sumCosts(costs),
        latencyMs: this.deps.now() - startedAt,
      };
    }
  }

  private async runJudge(
    question: EvalQuestion,
    excerpts: readonly KnowledgeExcerpt[],
    answer: string,
  ): Promise<JudgeOutcome> {
    const judge = this.deps.judge;
    if (!judge) throw new Error('judge is not configured');
    const request = buildJudgeRequest({
      model: judge.model,
      question: question.question,
      turns: question.turns ?? [],
      answerable: isAnswerable(question),
      excerpts,
      answer,
    });
    const result = await generateOnce(
      judge.provider,
      request,
      this.options.limits.requestTimeoutMs,
    );
    const failed = result.error !== null || result.timedOut;
    const cost = await this.recordCall(
      {
        kind: 'eval',
        outcome: !failed ? 'complete' : result.timedOut ? 'timeout' : 'failed',
        sourceId: this.sourceId('judge'),
        attempt: 1,
        provider: judge.billing,
        model: result.usage?.model ?? request.model,
        requestedModel: request.model,
        tokens: ledgerTokensFromLlm(result.usage),
        reportedCost: result.usage?.reportedCost ?? null,
        requestId: result.requestId,
      },
      null,
    );
    this.spentJudge = this.spentJudge.add(cost.value ?? ZERO);
    if (failed) return { verdict: null, error: 'provider', cost };
    const parsed = parseJudgeOutput(result.text);
    return parsed.ok
      ? { verdict: parsed.verdict, error: null, cost }
      : { verdict: null, error: parsed.error, cost };
  }

  /**
   * Рядок журналу ПІСЛЯ виклику + вартість виклику для звіту й запобіжника: сума провайдера,
   * інакше тариф, інакше невідомо (для запобіжника — оцінка до старту)
   */
  private async recordCall(entry: UsageEntry, fallback: Decimal | null): Promise<CallCost> {
    await this.deps.record([entry]);
    const cost = await this.costOf(entry.provider, [entry.model, entry.requestedModel], {
      reportedCost: entry.reportedCost,
      tokens: entry.tokens,
    });
    if (cost.value === null) this.unknownCostCalls += 1;
    this.options.budget.add(cost.value ?? fallback ?? ZERO);
    return cost;
  }

  /** Embedding питання: ціна для відповіді завжди; у витрати прогону — лише справжній виклик */
  private async embeddingCost(
    embedding: NonNullable<EvalRetrieval['embedding']>,
  ): Promise<CallCost> {
    const billing = embedding.usage.billing;
    const cost = await this.costOf(billing?.provider ?? 'unknown', [billing?.model], {
      reportedCost: billing?.reportedCost ?? null,
      tokens: {
        inputTokens: embedding.usage.inputTokens,
        cachedReadTokens: null,
        cacheWriteTokens: null,
        outputTokens: 0,
        reasoningTokens: null,
      },
    });
    if (embedding.fresh) {
      if (cost.value === null) this.unknownCostCalls += 1;
      this.spentAnswers = this.spentAnswers.add(cost.value ?? ZERO);
      this.options.budget.add(cost.value ?? ZERO);
    }
    return cost;
  }

  private async costOf(
    provider: string,
    models: readonly (string | undefined)[],
    call: { reportedCost: string | null; tokens: LedgerTokens | null },
  ): Promise<CallCost> {
    if (call.reportedCost !== null) {
      return { value: new Prisma.Decimal(call.reportedCost), status: 'reported' };
    }
    if (provider === FAKE_BILLING) return { value: ZERO, status: 'reported' };
    if (call.tokens) {
      for (const model of new Set(models.filter((m): m is string => Boolean(m)))) {
        const tariff = await this.deps.findTariff(provider, model);
        const value = tariff ? estimateCost(call.tokens, tariff) : null;
        if (value) return { value, status: 'estimated' };
      }
    }
    return { value: null, status: 'unknown' };
  }
}

function failureCode(result: AttemptResult): string {
  if (result.timedOut) return 'timeout';
  return result.error instanceof LlmProviderError ? 'provider' : 'internal';
}

/** Сума вартостей: невідома частина робить невідомою всю суму; статус — найслабший */
export function sumCosts(costs: readonly CallCost[]): CallCost {
  if (costs.some((c) => c.value === null)) return { value: null, status: 'unknown' };
  const value = costs.reduce((sum, c) => sum.add(c.value ?? ZERO), ZERO);
  const status: CostStatus = costs.every((c) => c.status === 'reported') ? 'reported' : 'estimated';
  return { value, status };
}
