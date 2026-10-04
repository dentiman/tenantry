import '../libs/database/load-root-env';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Prisma } from '@saas-skeleton/database';
import { z } from 'zod';
import { createLlmProvider } from '../libs/shared/src/ai/ai-llm.module';
import { loadAiConfig } from '../libs/shared/src/ai/ai.config';
import { billingProviderFor, FAKE_BILLING } from '../libs/shared/src/ai/costs/billing';
import { AiUsageLedger, findTariff } from '../libs/shared/src/ai/costs/usage-ledger';
import {
  BudgetExceededError,
  BudgetGuard,
  MissingTariffError,
} from '../libs/shared/src/ai/eval/budget';
import { EvalConfigFileSchema, resolveEvalConfigs } from '../libs/shared/src/ai/eval/eval-config';
import { QuestionSetSchema } from '../libs/shared/src/ai/eval/question-set';
import {
  renderSummary,
  resultsTable,
  summarize,
  type RunMeta,
} from '../libs/shared/src/ai/eval/report';
import {
  AnswerEvalRunner,
  estimateRun,
  type AnswerEvalDeps,
} from '../libs/shared/src/ai/eval/runner';
import { cliCancellation, withKnowledgeTenant } from '../libs/shared/src/ai/knowledge/cli-runtime';
import type {
  EmbeddingBatch,
  EmbeddingProvider,
} from '../libs/shared/src/ai/knowledge/embedding-provider';
import { EmbeddingRequestError } from '../libs/shared/src/ai/knowledge/openai-embedding-provider';
import {
  PostgresKnowledgeSource,
  selectionFromRetrieval,
} from '../libs/shared/src/ai/knowledge/postgres-knowledge-source';
import { PostgresKnowledgeStore } from '../libs/shared/src/ai/knowledge/postgres-knowledge-store';
import { RecordingEmbeddingProvider } from '../libs/shared/src/ai/knowledge/recording-embedding-provider';
import { RuntimeEmbeddingProvider } from '../libs/shared/src/ai/knowledge/runtime-embedding-provider';
import { FakeLlmProvider } from '../libs/shared/src/ai/llm/fake-llm.provider';
import type { LlmProvider } from '../libs/shared/src/ai/llm/llm-provider';
import { resolveGenerationSettings } from '../libs/shared/src/ai/platform/platform-ai-settings';
import { loadMasterKey } from '../libs/shared/src/ai/platform/secret-box';
import { readAiSettings } from '../libs/shared/src/ai/prompt/organization-instructions';

/**
 * Eval відповідей (AI-5c, docs/ai-platform-controls.md §8–§9, docs/ai-sources/README.md):
 * набір питань × файл конфігурацій → відповіді через той самий конвеєр, що в чаті
 * (пошук → `buildGenerationRequest` → модель), без розмов і повідомлень. Пише лише журнал
 * витрат (`kind = eval`). Розмов користувачів не читає.
 */

const USAGE = `pnpm ai:answers:eval --tenant <id-or-slug> [--questions docs/ai-sources/fms-eval.json]
  [--configs docs/ai-sources/answer-eval-configs.json] [--judge <model>] [--repeat N]
  [--max-cost <USD>] [--output <dir>] [--locale en] [--only q01,q02] [--fake]`;

/** Помилка аргументів чи налаштувань, яку можна показати як є */
class EvalUsageError extends Error {}

/** Кеш embedding-ів питань за текстом: однаковий для всіх конфігурацій і повторів */
class CachingEmbeddings implements EmbeddingProvider {
  private readonly cache = new Map<string, Promise<EmbeddingBatch>>();
  calls = 0;

  constructor(private readonly inner: EmbeddingProvider) {}

  embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch> {
    const key = texts.join('\u0000');
    let cached = this.cache.get(key);
    if (!cached) {
      this.calls += 1;
      cached = this.inner.embed(texts, signal);
      // Збій не кешується — наступна конфігурація спробує знову
      cached.catch(() => this.cache.delete(key));
      this.cache.set(key, cached);
    }
    return cached;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `${stamp}Z-${randomBytes(2).toString('hex')}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      questions: { type: 'string', default: 'docs/ai-sources/fms-eval.json' },
      configs: { type: 'string', default: 'docs/ai-sources/answer-eval-configs.json' },
      judge: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      'max-cost': { type: 'string' },
      output: { type: 'string' },
      locale: { type: 'string', default: 'en' },
      only: { type: 'string' },
      fake: { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help || !values.tenant) {
    console.log(USAGE);
    return;
  }
  const tenant = values.tenant;
  const set = QuestionSetSchema.parse(JSON.parse(readFileSync(values.questions, 'utf8')));
  const configFile = EvalConfigFileSchema.parse(JSON.parse(readFileSync(values.configs, 'utf8')));
  const repeats = z.coerce.number().int().min(1).max(20).parse(values.repeat);
  const maxCost =
    values['max-cost'] !== undefined
      ? new Prisma.Decimal(
          z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .parse(values['max-cost']),
        )
      : null;
  const only = values.only?.split(',').map((id) => id.trim());
  const questions = only ? set.questions.filter((q) => only.includes(q.id)) : set.questions;
  if (questions.length === 0) throw new EvalUsageError('No questions selected (--only)');

  const aiConfig = loadAiConfig();
  const masterKey = loadMasterKey();
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const cancellation = cliCancellation();

  try {
    await withKnowledgeTenant(tenant, async (transactions) => {
      // Налаштування платформи (UI суперадміна поверх env) — так само, як воркер; таблиця без RLS
      const row = await transactions.withTenantTx((tx) =>
        tx.platformAiSettings.findUnique({
          where: { id: 'default' },
          select: {
            enabled: true,
            provider: true,
            baseUrl: true,
            model: true,
            apiKeyEncrypted: true,
            apiKeyHint: true,
          },
        }),
      );
      const effective = resolveGenerationSettings(row, aiConfig, masterKey);
      let provider: LlmProvider;
      let billing: string;
      if (values.fake || effective.provider === 'fake') {
        provider = new FakeLlmProvider();
        billing = FAKE_BILLING;
      } else {
        if (!effective.baseUrl || !effective.apiKey) {
          throw new EvalUsageError(
            'AI provider is not configured: set base URL and key in the superadmin settings or AI_BASE_URL / AI_API_KEY',
          );
        }
        provider = createLlmProvider({
          ...aiConfig,
          enabled: true,
          provider: effective.provider,
          baseUrl: effective.baseUrl,
          apiKey: effective.apiKey,
          model: effective.model,
          modelConfigured: true,
        });
        billing = billingProviderFor(effective.provider, effective.baseUrl);
      }
      const judge = values.judge ? { provider, billing, model: values.judge } : null;
      if (
        maxCost === null &&
        (billing !== FAKE_BILLING || (judge && judge.billing !== FAKE_BILLING))
      ) {
        throw new EvalUsageError(
          '--max-cost <USD> is required unless generation and judge are fake',
        );
      }

      const configs = resolveEvalConfigs(configFile, {
        model: effective.model,
        maxOutputTokens: aiConfig.maxOutputTokens,
        historyTurns: aiConfig.historyTurns,
        finalChunks: aiConfig.knowledge.finalChunks,
        maxContextTokens: aiConfig.knowledge.maxContextTokens,
        searchMode: aiConfig.knowledge.mode,
        maxDistance: aiConfig.knowledge.maxDistance,
      });
      if (judge && configs.some((c) => c.model === judge.model)) {
        warnings.push(`Judge model ${judge.model} is also a candidate: it grades its own answers.`);
      }
      if (aiConfig.knowledge.product !== null && aiConfig.knowledge.product !== set.product) {
        warnings.push(
          `Question set product "${set.product}" differs from AI_KNOWLEDGE_PRODUCT "${aiConfig.knowledge.product}".`,
        );
      }

      // Інструкції організації tenant-а — та сама секція `settings.ai`, що читає воркер
      const tenantRow = await transactions.withTenantTx((tx) =>
        tx.tenant.findFirst({ select: { settings: true } }),
      );
      const aiSettings = readAiSettings(tenantRow?.settings);
      if (!aiSettings.valid) warnings.push('Tenant settings.ai is invalid — boundaries only.');
      const organization = {
        persona: aiSettings.settings.persona,
        instructions: aiSettings.settings.instructions,
      };

      const ledger = new AiUsageLedger();
      const embeddings = new CachingEmbeddings(
        new RecordingEmbeddingProvider(
          new RuntimeEmbeddingProvider(aiConfig, {
            read: (): Promise<typeof row> => Promise.resolve(row),
          }),
          transactions,
          ledger,
          { kind: 'eval', sourceId: `answers-eval:${runId}:embedding` },
        ),
      );
      const store = new PostgresKnowledgeStore(transactions);

      const deps: AnswerEvalDeps = {
        retrieve: async (config, question) => {
          const source = new PostgresKnowledgeSource(store, embeddings, {
            product: set.product,
            mode: config.searchMode,
            vectorCandidates: aiConfig.knowledge.vectorCandidates,
            textCandidates: aiConfig.knowledge.textCandidates,
            finalChunks: config.finalChunks,
            maxContextTokens: config.maxContextTokens,
            maxDistance: config.maxDistance,
          });
          const before = embeddings.calls;
          const result = await source.retrieve({
            role: question.role,
            question: question.question,
          });
          return {
            selection: selectionFromRetrieval(set.product, result),
            degraded: result.degraded,
            embedding: result.queryEmbedding
              ? { usage: result.queryEmbedding, fresh: embeddings.calls > before }
              : null,
          };
        },
        generator: { provider, billing },
        judge,
        record: (entries) => transactions.withTenantTx((tx) => ledger.record(tx, entries)),
        findTariff: (tariffProvider, model) =>
          transactions.withTenantTx((tx) => findTariff(tx, tariffProvider, new Date(), [model])),
        sleep,
        now: () => Date.now(),
        log: (line) => {
          console.error(line);
        },
      };

      const options = {
        runId,
        questions,
        configs,
        repeats,
        locale: values.locale,
        organization,
        limits: {
          requestTimeoutMs: aiConfig.requestTimeoutMs,
          providerRetries: aiConfig.providerRetries,
          retryDelayMs: aiConfig.retryDelayMs,
        },
        budget: new BudgetGuard(maxCost),
        signal: cancellation.signal,
      };

      const estimate = await estimateRun(options, deps);
      console.error(
        `Run ${runId}: ${String(questions.length)} questions × ${String(configs.length)} configs × ${String(repeats)} = ${String(questions.length * configs.length * repeats)} answers, estimate ≤ $${estimate.total.toFixed()}${maxCost ? ` (limit $${maxCost.toFixed()})` : ''}`,
      );
      options.budget.assertEstimate(estimate.total);

      const runner = new AnswerEvalRunner(
        deps,
        {
          ...options,
          onAnswer: (record, done, total): void => {
            const status = record.error ?? (record.checks?.answered === false ? 'no-cite' : 'ok');
            console.error(
              `[${String(done)}/${String(total)}] ${record.questionId} × ${record.config}: ${status}, ${String(record.latencyMs)} ms`,
            );
          },
        },
        estimate,
      );
      const result = await runner.run();

      const events = await transactions.withTenantTx((tx) =>
        tx.aiUsageEvent.findMany({
          where: { kind: 'eval', sourceId: { startsWith: `answers-eval:${runId}:` } },
          select: { reportedCost: true, estimatedCost: true },
        }),
      );
      const ledgerTotal = events.reduce(
        (sum, e) => sum.add(e.reportedCost ?? e.estimatedCost ?? 0),
        new Prisma.Decimal(0),
      );

      const summaries = summarize(result, configs, repeats);
      const meta: RunMeta = {
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        tenant,
        questionSet: {
          path: values.questions,
          product: set.product,
          ...(set.status ? { status: set.status } : {}),
        },
        questions: questions.length,
        repeats,
        locale: values.locale,
        organizationInstructions:
          organization.persona.trim() !== '' || organization.instructions.trim() !== '',
        generationProvider: billing,
        judge: judge ? { provider: judge.billing, model: judge.model } : null,
        maxCost: maxCost?.toFixed() ?? null,
        estimate: estimate.total.toFixed(),
        stopped: result.stopped,
        spent: {
          answers: result.spentAnswers.toFixed(),
          judge: result.spentJudge.toFixed(),
          total: result.spentAnswers.add(result.spentJudge).toFixed(),
        },
        ledgerTotal: ledgerTotal.toFixed(),
        unknownCostCalls: result.unknownCostCalls,
        warnings,
      };

      console.log(`\n${resultsTable(summaries, judge !== null)}\n`);
      console.log(
        `Spent by this run: $${meta.spent.total} (answers $${meta.spent.answers}, judge $${meta.spent.judge}); ledger: $${ledgerTotal.toFixed()}`,
      );
      if (result.stopped) console.log(`Stopped: ${result.stopped} — partial report.`);
      for (const warning of warnings) console.log(`Warning: ${warning}`);

      if (values.output) {
        mkdirSync(values.output, { recursive: true });
        writeFileSync(join(values.output, 'summary.md'), renderSummary(meta, configs, summaries));
        writeFileSync(
          join(values.output, 'answers.json'),
          `${JSON.stringify({ meta, configs, summaries, records: result.records }, null, 2)}\n`,
        );
        console.log(`Report: ${values.output}/summary.md, ${values.output}/answers.json`);
      }
    });
  } finally {
    cancellation.dispose();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof MissingTariffError ||
      error instanceof BudgetExceededError ||
      error instanceof EvalUsageError
      ? error.message
      : error instanceof EmbeddingRequestError
        ? error.code
        : error instanceof z.ZodError
          ? `Invalid arguments, question set or configuration file: ${error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`
          : 'Answer eval failed; check arguments, tenant, database/migrations and AI configuration.',
  );
  process.exitCode = 1;
});
