import '../libs/database/load-root-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { parseKnowledgeCorpus } from '../libs/shared/src/ai/knowledge/corpus-builder';
import { previewCorpus } from '../libs/shared/src/ai/knowledge/ingest/corpus-preview';
import { KnowledgeIngestor } from '../libs/shared/src/ai/knowledge/ingest/knowledge-ingestor';
import { PostgresIngestStore } from '../libs/shared/src/ai/knowledge/ingest/postgres-ingest-store';
import {
  cliCancellation,
  requireEmbeddingProvider,
  withKnowledgeTenant,
} from '../libs/shared/src/ai/knowledge/cli-runtime';
import { EmbeddingRequestError } from '../libs/shared/src/ai/knowledge/openai-embedding-provider';
import { RecordingEmbeddingProvider } from '../libs/shared/src/ai/knowledge/recording-embedding-provider';
import { AiUsageLedger } from '../libs/shared/src/ai/costs/usage-ledger';

const CORPUS_PATH = join(
  __dirname,
  '..',
  'libs/shared/src/ai/knowledge/generated/knowledge-corpus.json',
);

const USAGE =
  'pnpm ai:knowledge:index (--tenant <slug-or-id> [--tenant …] | --all-tenants | --dry-run)';

/**
 * Активні тенанти для `--all-tenants`. `tenants` під RLS, тож `saas_app` їх списку не бачить:
 * читаємо роллю control plane (`PLATFORM_DATABASE_URL`) — лише `SELECT slug`. Сама індексація
 * потім іде під `saas_app` окремо на кожен тенант (`withKnowledgeTenant`), як у `ai:docs:ingest`.
 */
async function activeTenantSlugs(): Promise<string[]> {
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) throw new Error('--all-tenants needs PLATFORM_DATABASE_URL (control-plane role)');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ slug: string }>(
      'SELECT slug FROM tenants WHERE is_active = true ORDER BY slug',
    );
    return result.rows.map((row) => row.slug);
  } finally {
    await client.end();
  }
}

/** Код помилки без тексту: SQL і відповіді провайдера в лог не потрапляють (як у ai:docs:ingest) */
function errorCode(error: unknown): string {
  return error instanceof EmbeddingRequestError
    ? error.code
    : 'ingest-failed (check tenant, database/migrations and embedding configuration)';
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string', multiple: true },
      'all-tenants': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  // Той самий закомічений артефакт, що вбудовано в образ воркера для статичного бекенду
  const corpus = parseKnowledgeCorpus(JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as unknown);
  const preview = previewCorpus(corpus);
  console.error(
    `Corpus ${corpus.version}: ${String(preview.totals.documents)} documents, ${String(preview.totals.chunks)} chunks, ` +
      `${String(preview.totals.embeddingTokens)} embedding tokens per tenant (revision ${preview.revision.slice(0, 12)})`,
  );
  if (values['dry-run']) {
    console.log(
      JSON.stringify(
        { product: preview.product, revision: preview.revision, totals: preview.totals },
        null,
        2,
      ),
    );
    return;
  }

  const explicit = values.tenant ?? [];
  if ((explicit.length === 0) === (values['all-tenants'] !== true)) {
    throw new Error(`Pass exactly one of --tenant or --all-tenants. Usage: ${USAGE}`);
  }
  const tenants = values['all-tenants'] ? await activeTenantSlugs() : explicit;
  if (tenants.length === 0) throw new Error('No active tenants to index');

  const provider = requireEmbeddingProvider();
  const cancellation = cliCancellation();
  const results: Record<string, unknown>[] = [];
  let failed = 0;
  try {
    // Послідовно: векторів між тенантами не перевикористати (RLS), а паралельні тенанти лише
    // множили б одночасні запити до провайдера понад AI_EMBEDDING_CONCURRENCY
    for (const tenant of tenants) {
      try {
        const result = await withKnowledgeTenant(tenant, (tx) =>
          new KnowledgeIngestor(
            new PostgresIngestStore(tx),
            // Кожен оплачений батч — рядок журналу витрат (kind=ingest_embedding) під цим тенантом
            new RecordingEmbeddingProvider(provider, tx, new AiUsageLedger(), {
              kind: 'ingest_embedding',
              sourceId: `${preview.product}/${preview.sourceKey}`,
            }),
          ).ingest(preview, cancellation.signal, {
            batchSize: Number(process.env.AI_EMBEDDING_BATCH_SIZE ?? 32),
            concurrency: Number(process.env.AI_EMBEDDING_CONCURRENCY ?? 2),
          }),
        );
        results.push({ tenant, ...result });
        console.error(
          `  ${tenant}: ${result.unchanged ? 'unchanged' : `indexed, ${String(result.inputTokens)} tokens`}`,
        );
      } catch (error) {
        failed += 1;
        results.push({ tenant, error: errorCode(error) });
        console.error(`  ${tenant}: FAILED — ${errorCode(error)}`);
      }
    }
  } finally {
    cancellation.dispose();
  }
  console.log(JSON.stringify({ product: preview.product, revision: preview.revision, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Indexing failed');
  process.exitCode = 1;
});
