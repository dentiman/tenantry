import '../libs/database/load-root-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  requireEmbeddingProvider,
  withKnowledgeTenant,
} from '../libs/shared/src/ai/knowledge/cli-runtime';
import type {
  EmbeddingBatch,
  EmbeddingProvider,
} from '../libs/shared/src/ai/knowledge/embedding-provider';
import { EmbeddingRequestError } from '../libs/shared/src/ai/knowledge/openai-embedding-provider';
import { RecordingEmbeddingProvider } from '../libs/shared/src/ai/knowledge/recording-embedding-provider';
import { AiUsageLedger } from '../libs/shared/src/ai/costs/usage-ledger';
import {
  PostgresKnowledgeSource,
  type KnowledgeRetrieval,
  type KnowledgeSearchMode,
} from '../libs/shared/src/ai/knowledge/postgres-knowledge-source';
import { PostgresKnowledgeStore } from '../libs/shared/src/ai/knowledge/postgres-knowledge-store';
import { QuestionSetSchema, type EvalQuestion } from '../libs/shared/src/ai/eval/question-set';

/**
 * Retrieval-only eval (AI-2a.4, design.md D6): ті самі питання через кожен режим і поріг,
 * без генерації й без LLM-судді — детерміновано й майже безкоштовно. Embedding кожного
 * питання робиться ОДИН раз і кешується на всі конфігурації.
 */
type Question = EvalQuestion;

interface Config {
  readonly mode: KnowledgeSearchMode;
  readonly maxDistance: number | null;
}

interface Outcome {
  readonly id: string;
  readonly paths: string[];
  readonly hit: boolean;
  readonly rank: number | null;
  readonly searchMs: number;
  readonly degraded: boolean;
  /** Найближча distance серед УСІХ vector-кандидатів, і найближча до очікуваної сторінки */
  readonly topDistance: number | null;
  readonly expectedDistance: number | null;
  /** Те саме для FTS: найкращий text rank загалом і серед очікуваних сторінок */
  readonly topTextRank: number | null;
  readonly expectedTextRank: number | null;
  /** Скільки FTS-кандидатів знайшлося взагалі */
  readonly textCandidates: number;
}

/** Кеш embedding-ів питань + чесний облік: латентність і токени лише першого виклику */
class CachingEmbeddings implements EmbeddingProvider {
  private readonly cache = new Map<string, Promise<EmbeddingBatch>>();
  readonly latencies: number[] = [];
  tokens = 0;

  constructor(private inner: EmbeddingProvider) {}

  /** AI-5b: обгорнути справжній провайдер — у журнал іде лише виклик, що не з кешу */
  wrapInner(wrap: (inner: EmbeddingProvider) => EmbeddingProvider): void {
    this.inner = wrap(this.inner);
  }

  embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch> {
    const key = texts.join('\u0000');
    let cached = this.cache.get(key);
    if (!cached) {
      const startedAt = Date.now();
      cached = this.inner.embed(texts, signal).then((batch) => {
        this.latencies.push(Date.now() - startedAt);
        this.tokens += batch.inputTokens;
        return batch;
      });
      this.cache.set(key, cached);
    }
    return cached;
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function evaluate(question: Question, result: KnowledgeRetrieval): Outcome {
  const paths = result.excerpts.map((e) => e.path);
  const expected = new Set(question.expected);
  const firstHit = paths.findIndex((path) => expected.has(path));
  const hit =
    question.expected.length === 0
      ? paths.length === 0
      : question.expectAll
        ? question.expected.every((path) => paths.includes(path))
        : firstHit >= 0;
  const expectedDistances = result.vector
    .filter((m) => expected.has(m.path))
    .map((m) => m.distance);
  const expectedRanks = result.text.filter((m) => expected.has(m.path)).map((m) => m.textRank);
  return {
    id: question.id,
    paths,
    hit,
    rank: firstHit >= 0 ? firstHit + 1 : null,
    searchMs: result.searchMs,
    degraded: result.degraded,
    topDistance: result.vector[0]?.distance ?? null,
    expectedDistance: expectedDistances.length > 0 ? Math.min(...expectedDistances) : null,
    topTextRank: result.text[0]?.textRank ?? null,
    expectedTextRank: expectedRanks.length > 0 ? Math.max(...expectedRanks) : null,
    textCandidates: result.text.length,
  };
}

function label(config: Config): string {
  return config.maxDistance === null ? config.mode : `${config.mode}≤${String(config.maxDistance)}`;
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}%`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      questions: { type: 'string', default: 'docs/ai-sources/fms-eval.json' },
      modes: { type: 'string', default: 'vector,fts,hybrid' },
      thresholds: { type: 'string', default: 'none' },
      k: { type: 'string', default: '5' },
      output: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help || !values.tenant) {
    console.log(
      'pnpm ai:docs:eval --tenant <id-or-slug> [--questions file] [--modes vector,fts,hybrid] [--thresholds none,0.6,0.65] [--k 5] [--output report.json]',
    );
    return;
  }
  const set = QuestionSetSchema.parse(JSON.parse(readFileSync(values.questions, 'utf8')));
  const k = Number(values.k);
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new Error('k must be 1–20');
  const modes = values.modes
    .split(',')
    .map((m) => z.enum(['vector', 'fts', 'hybrid']).parse(m.trim()));
  const thresholds = values.thresholds
    .split(',')
    .map((t) => (t.trim() === 'none' ? null : z.coerce.number().gt(0).max(2).parse(t.trim())));
  // FTS не має порогу: один рядок замість повтору на кожен поріг
  const configs: Config[] = modes.flatMap((mode) =>
    mode === 'fts'
      ? [{ mode, maxDistance: null }]
      : thresholds.map((maxDistance) => ({ mode, maxDistance })),
  );

  const embeddings = new CachingEmbeddings(requireEmbeddingProvider());
  const results = await withKnowledgeTenant(values.tenant, async (tx) => {
    // AI-5b: кожен оплачений embedding-виклик eval — рядок журналу витрат під цим tenant-ом
    embeddings.wrapInner(
      (inner) =>
        new RecordingEmbeddingProvider(inner, tx, new AiUsageLedger(), {
          kind: 'eval',
          sourceId: 'ai:docs:eval',
        }),
    );
    const store = new PostgresKnowledgeStore(tx);
    const all = new Map<string, Outcome[]>();
    for (const config of configs) {
      const source = new PostgresKnowledgeSource(store, embeddings, {
        product: set.product,
        mode: config.mode,
        vectorCandidates: 12,
        textCandidates: 12,
        finalChunks: k,
        maxContextTokens: 2_500,
        maxDistance: config.maxDistance,
      });
      const outcomes: Outcome[] = [];
      for (const question of set.questions) {
        const retrieval = await source.retrieve({
          role: question.role,
          question: question.question,
        });
        outcomes.push(evaluate(question, retrieval));
      }
      all.set(label(config), outcomes);
    }
    return all;
  });

  const answerable = set.questions.filter((q) => q.expected.length > 0);
  const unanswerable = set.questions.filter((q) => q.expected.length === 0);
  const categories = [...new Set(answerable.map((q) => q.category))];
  const byId = new Map(set.questions.map((q) => [q.id, q]));

  console.log(
    `\n${String(set.questions.length)} questions (${String(answerable.length)} answerable, ${String(unanswerable.length)} unanswerable), k=${String(k)}${set.status ? `\nQuestion set: ${set.status}` : ''}\n`,
  );
  console.log(
    `| config | Recall@${String(k)} | MRR | ${categories.join(' | ')} | abstain (none) | search p50/p95 ms |`,
  );
  console.log(`|${' --- |'.repeat(5 + categories.length)}`);
  for (const [name, outcomes] of results) {
    const answered = outcomes.filter((o) => (byId.get(o.id)?.expected.length ?? 0) > 0);
    const none = outcomes.filter((o) => byId.get(o.id)?.expected.length === 0);
    const mrr = answered.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0) / answered.length;
    const perCategory = categories.map((category) => {
      const inCategory = answered.filter((o) => byId.get(o.id)?.category === category);
      return pct(inCategory.filter((o) => o.hit).length, inCategory.length);
    });
    const ms = outcomes.map((o) => o.searchMs);
    console.log(
      `| ${name} | ${pct(answered.filter((o) => o.hit).length, answered.length)} | ${mrr.toFixed(2)} | ${perCategory.join(' | ')} | ${pct(none.filter((o) => o.hit).length, none.length)} | ${String(percentile(ms, 50))}/${String(percentile(ms, 95))} |`,
    );
  }

  // Розподіл distance — підстава для порогу: де лежать правильні сторінки, а де найближчий
  // кандидат на питання без відповіді (за vector без порогу, якщо він був у прогоні)
  const reference = results.get('vector') ?? results.get('hybrid');
  if (reference) {
    const expectedDistances = reference
      .filter((o) => o.expectedDistance !== null)
      .map((o) => ({ o, q: byId.get(o.id) }));
    const missing = reference.filter(
      (o) => (byId.get(o.id)?.expected.length ?? 0) > 0 && o.expectedDistance === null,
    );
    console.log('\nVector distance of the closest EXPECTED page (answerable questions):');
    for (const lang of [...new Set(expectedDistances.map(({ q }) => q?.language))]) {
      const d = expectedDistances
        .filter(({ q }) => q?.language === lang)
        .map(({ o }) => o.expectedDistance ?? 0);
      console.log(
        `  ${String(lang)}: min ${Math.min(...d).toFixed(3)}, median ${percentile(d, 50).toFixed(3)}, max ${Math.max(...d).toFixed(3)} (n=${String(d.length)})`,
      );
    }
    if (missing.length > 0)
      console.log(`  not in vector top-12 at all: ${missing.map((o) => o.id).join(', ')}`);
    const noneTop = reference
      .filter((o) => byId.get(o.id)?.expected.length === 0)
      .map((o) => `${o.id}=${o.topDistance?.toFixed(3) ?? '—'}`);
    console.log(`Closest candidate for UNANSWERABLE questions: ${noneTop.join(', ')}`);
  }
  console.log(
    `\nEmbedding: ${String(embeddings.latencies.length)} calls, ${String(embeddings.tokens)} tokens, p50/p95 ${String(percentile(embeddings.latencies, 50))}/${String(percentile(embeddings.latencies, 95))} ms (cached across configs)`,
  );

  if (values.output) {
    writeFileSync(
      values.output,
      `${JSON.stringify({ k, questions: set.questions, results: Object.fromEntries(results) }, null, 2)}\n`,
    );
    console.log(`Report: ${values.output}`);
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof EmbeddingRequestError
      ? error.code
      : error instanceof z.ZodError
        ? `Invalid arguments or question set: ${error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`
        : 'Eval failed; check arguments, tenant, database/migrations and embedding configuration.',
  );
  process.exitCode = 1;
});
