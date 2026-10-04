import { Prisma } from '@saas-skeleton/database';
import type { ResolvedEvalConfig } from './eval-config';
import type { AnswerEvalResult, AnswerRecord } from './runner';

/**
 * Звіт eval відповідей (AI-5c, design.md D7/I9): таблиця «якість × ціна відповіді» на
 * конфігурацію — у термінал і `summary.md`, усі відповіді — в `answers.json`.
 */

type Decimal = Prisma.Decimal;

export interface Rate {
  /** Скільки відповідей, до яких перевірка застосовна, і скільки її пройшли */
  readonly n: number;
  readonly ok: number;
  /** Середня частка по повторах; `null` — не застосовна ні до чого */
  readonly mean: number | null;
  /** Розкид частки по повторах (лише коли повторів > 1) */
  readonly min: number | null;
  readonly max: number | null;
}

export interface ConfigSummary {
  readonly config: string;
  readonly answers: number;
  readonly errors: number;
  readonly answered: Rate;
  readonly refusalOk: Rate;
  readonly citationsValid: Rate;
  readonly citationHit: Rate;
  readonly retrievalHit: Rate;
  readonly numbersGrounded: Rate;
  readonly languageOk: Rate;
  readonly truncated: Rate;
  readonly mentionsOk: Rate;
  readonly judgeGrounded: number | null;
  readonly judgeAnswers: number | null;
  readonly judgeErrors: number;
  /** Ціна відповіді як у проді — середня й p90 серед відповідей з відомою вартістю */
  readonly avgCost: Decimal | null;
  readonly p90Cost: Decimal | null;
  readonly unknownCost: number;
  readonly avgLatencyMs: number | null;
  readonly avgOutputTokens: number | null;
}

type Check = (record: AnswerRecord) => boolean | null;

const CHECKS: Record<
  | 'answered'
  | 'refusalOk'
  | 'citationsValid'
  | 'citationHit'
  | 'retrievalHit'
  | 'numbersGrounded'
  | 'languageOk'
  | 'truncated'
  | 'mentionsOk',
  Check
> = {
  answered: (r) => r.checks?.answered ?? null,
  refusalOk: (r) => r.refusalOk,
  citationsValid: (r) => r.checks?.citationsValid ?? null,
  citationHit: (r) => r.checks?.citationHit ?? null,
  retrievalHit: (r) => r.checks?.retrievalHit ?? null,
  numbersGrounded: (r) => r.checks?.numbersGrounded ?? null,
  languageOk: (r) => r.checks?.languageOk ?? null,
  truncated: (r) => r.checks?.truncated ?? null,
  mentionsOk: (r) => r.checks?.mentionsOk ?? null,
};

function rate(records: readonly AnswerRecord[], check: Check, repeats: number): Rate {
  const values = records.map((r) => ({ repeat: r.repeat, value: check(r) }));
  const applicable = values.filter((v) => v.value !== null);
  const ok = applicable.filter((v) => v.value === true).length;
  const perRepeat: number[] = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const inRepeat = applicable.filter((v) => v.repeat === repeat);
    if (inRepeat.length > 0) {
      perRepeat.push(inRepeat.filter((v) => v.value === true).length / inRepeat.length);
    }
  }
  const mean =
    perRepeat.length > 0 ? perRepeat.reduce((sum, v) => sum + v, 0) / perRepeat.length : null;
  return {
    n: applicable.length,
    ok,
    mean,
    min: repeats > 1 && perRepeat.length > 0 ? Math.min(...perRepeat) : null,
    max: repeats > 1 && perRepeat.length > 0 ? Math.max(...perRepeat) : null,
  };
}

function average(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/** p-й перцентиль (nearest-rank), десятково */
export function decimalPercentile(values: readonly Decimal[], p: number): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

export function summarize(
  result: Pick<AnswerEvalResult, 'records'>,
  configs: readonly ResolvedEvalConfig[],
  repeats: number,
): ConfigSummary[] {
  return configs.map((config) => {
    const records = result.records.filter((r) => r.config === config.name);
    const succeeded = records.filter((r) => r.error === null);
    const costs = succeeded.flatMap((r) => (r.cost.answer.value ? [r.cost.answer.value] : []));
    const verdicts = records.flatMap((r) => (r.judge?.verdict ? [r.judge.verdict] : []));
    return {
      config: config.name,
      answers: records.length,
      errors: records.length - succeeded.length,
      answered: rate(records, CHECKS.answered, repeats),
      refusalOk: rate(records, CHECKS.refusalOk, repeats),
      citationsValid: rate(records, CHECKS.citationsValid, repeats),
      citationHit: rate(records, CHECKS.citationHit, repeats),
      retrievalHit: rate(records, CHECKS.retrievalHit, repeats),
      numbersGrounded: rate(records, CHECKS.numbersGrounded, repeats),
      languageOk: rate(records, CHECKS.languageOk, repeats),
      truncated: rate(records, CHECKS.truncated, repeats),
      mentionsOk: rate(records, CHECKS.mentionsOk, repeats),
      judgeGrounded: average(verdicts.map((v) => v.grounded)),
      judgeAnswers: average(verdicts.map((v) => v.answers_question)),
      judgeErrors: records.filter((r) => r.judge?.error).length,
      avgCost:
        costs.length > 0
          ? costs.reduce((sum, c) => sum.add(c), new Prisma.Decimal(0)).div(costs.length)
          : null,
      p90Cost: decimalPercentile(costs, 90),
      unknownCost: succeeded.length - costs.length,
      avgLatencyMs: average(succeeded.map((r) => r.latencyMs)),
      avgOutputTokens: average(
        succeeded.flatMap((r) => (r.usage ? [r.usage.completionTokens] : [])),
      ),
    };
  });
}

const percent = (value: number): string => `${(100 * value).toFixed(0)}%`;

export function formatRate(value: Rate): string {
  if (value.mean === null) return '—';
  const spread =
    value.min !== null && value.max !== null && value.min !== value.max
      ? ` (${percent(value.min)}–${percent(value.max)})`
      : '';
  return `${percent(value.mean)}${spread}`;
}

/** USD без експоненти, 3 значущі цифри: `0.0000644` */
export function formatUsd(value: Decimal | null): string {
  return value === null ? '—' : `$${value.toSignificantDigits(3).toFixed()}`;
}

function formatNumber(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function resultsTable(summaries: readonly ConfigSummary[], judge: boolean): string {
  const header = [
    'config',
    'answered',
    'refused ok',
    'citations valid',
    'citation hit',
    'retrieval hit',
    'numbers grounded',
    'language',
    'truncated',
    'mentions',
    ...(judge ? ['judge grounded / answers'] : []),
    'avg $/answer',
    'p90 $/answer',
    'avg ms',
    'avg out tok',
    'errors',
  ];
  const rows = summaries.map((s) => [
    s.config,
    formatRate(s.answered),
    formatRate(s.refusalOk),
    formatRate(s.citationsValid),
    formatRate(s.citationHit),
    formatRate(s.retrievalHit),
    formatRate(s.numbersGrounded),
    formatRate(s.languageOk),
    formatRate(s.truncated),
    formatRate(s.mentionsOk),
    ...(judge
      ? [
          `${formatNumber(s.judgeGrounded, 2)} / ${formatNumber(s.judgeAnswers, 2)}${s.judgeErrors > 0 ? ` (${String(s.judgeErrors)} err)` : ''}`,
        ]
      : []),
    formatUsd(s.avgCost),
    formatUsd(s.p90Cost),
    formatNumber(s.avgLatencyMs),
    formatNumber(s.avgOutputTokens),
    String(s.errors),
  ]);
  return [header, header.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

export interface RunMeta {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly tenant: string;
  readonly questionSet: {
    readonly path: string;
    readonly product: string;
    readonly status?: string;
  };
  readonly questions: number;
  readonly repeats: number;
  readonly locale: string;
  readonly organizationInstructions: boolean;
  readonly generationProvider: string;
  readonly judge: { readonly provider: string; readonly model: string } | null;
  readonly maxCost: string | null;
  readonly estimate: string | null;
  readonly stopped: string | null;
  readonly spent: { readonly answers: string; readonly judge: string; readonly total: string };
  readonly ledgerTotal: string | null;
  readonly unknownCostCalls: number;
  readonly warnings: readonly string[];
}

function configsTable(configs: readonly ResolvedEvalConfig[]): string {
  const mark = (
    config: ResolvedEvalConfig,
    field: keyof ResolvedEvalConfig,
    text: string,
  ): string => ((config.overridden as readonly string[]).includes(field) ? `**${text}**` : text);
  const header = [
    'config',
    'model',
    'maxOutputTokens',
    'finalChunks',
    'maxContextTokens',
    'historyTurns',
    'searchMode',
    'maxDistance',
  ];
  const rows = configs.map((c) => [
    c.name,
    mark(c, 'model', c.model),
    mark(c, 'maxOutputTokens', String(c.maxOutputTokens)),
    mark(c, 'finalChunks', String(c.finalChunks)),
    mark(c, 'maxContextTokens', String(c.maxContextTokens)),
    mark(c, 'historyTurns', String(c.historyTurns)),
    mark(c, 'searchMode', c.searchMode),
    mark(c, 'maxDistance', c.maxDistance === null ? 'none' : String(c.maxDistance)),
  ]);
  return [header, header.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

export function renderSummary(
  meta: RunMeta,
  configs: readonly ResolvedEvalConfig[],
  summaries: readonly ConfigSummary[],
): string {
  return [
    `# Answer eval ${meta.runId}`,
    '',
    `- Started ${meta.startedAt}, finished ${meta.finishedAt}${meta.stopped ? ` — **stopped: ${meta.stopped}** (partial report)` : ''}`,
    `- Tenant \`${meta.tenant}\`, question set \`${meta.questionSet.path}\` (${meta.questionSet.product}, ${String(meta.questions)} questions${meta.questionSet.status ? `; ${meta.questionSet.status}` : ''})`,
    `- Repeats ${String(meta.repeats)}, locale \`${meta.locale}\`, organization instructions ${meta.organizationInstructions ? 'present' : 'none'}`,
    `- Generation billed by \`${meta.generationProvider}\`; judge ${meta.judge ? `\`${meta.judge.model}\` (${meta.judge.provider})` : 'off'}`,
    '',
    '## Configurations',
    '',
    'Bold — set by the configuration file; the rest — effective settings.',
    '',
    configsTable(configs),
    '',
    '## Results',
    '',
    'Rates are over the answers a check applies to (answered, citation and retrieval hit — questions with expected pages; refused ok — questions without). `$/answer` is the price of an answer as in production: generation plus the question embedding, even when this run took it from cache.',
    '',
    resultsTable(summaries, meta.judge !== null),
    '',
    '## Spent by this run',
    '',
    `- Answers (generation + uncached question embeddings): ${formatUsd(new Prisma.Decimal(meta.spent.answers))}`,
    `- Judge: ${formatUsd(new Prisma.Decimal(meta.spent.judge))}`,
    `- **Total: $${meta.spent.total}**; cost ledger (\`source_id\` \`answers-eval:${meta.runId}:%\`): ${meta.ledgerTotal === null ? '—' : `$${meta.ledgerTotal}`}`,
    `- Estimate before the run: ${meta.estimate === null ? '—' : `$${meta.estimate}`}; limit: ${meta.maxCost === null ? 'none (fake)' : `$${meta.maxCost}`}`,
    ...(meta.unknownCostCalls > 0
      ? [
          `- Calls without a known cost (neither reported nor priced): ${String(meta.unknownCostCalls)}`,
        ]
      : []),
    ...(meta.warnings.length > 0
      ? ['', '## Warnings', '', ...meta.warnings.map((w) => `- ${w}`)]
      : []),
    '',
  ].join('\n');
}
