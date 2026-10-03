import '../libs/database/load-root-env';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { previewSource } from '../libs/shared/src/ai/knowledge/ingest/preview';
import { KnowledgeIngestor } from '../libs/shared/src/ai/knowledge/ingest/knowledge-ingestor';
import { PostgresIngestStore } from '../libs/shared/src/ai/knowledge/ingest/postgres-ingest-store';
import {
  cliCancellation,
  embeddingProviderFromEnv,
  withKnowledgeTenant,
} from '../libs/shared/src/ai/knowledge/cli-runtime';
import { EmbeddingRequestError } from '../libs/shared/src/ai/knowledge/openai-embedding-provider';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      manifest: { type: 'string' },
      source: { type: 'string' },
      tenant: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'pnpm ai:docs:ingest --root <checkout> --manifest <json> --tenant <id-or-slug> [--source fms]',
    );
    return;
  }
  if (!values.root || !values.manifest || !values.tenant)
    throw new Error('root, manifest and tenant are required');
  const preview = previewSource(
    values.root,
    JSON.parse(readFileSync(values.manifest, 'utf8')) as unknown,
  );
  if (values.source && values.source !== preview.sourceKey)
    throw new Error('Source does not match manifest');
  console.error(
    `Ingest: ${String(preview.totals.documents)} documents, ${String(preview.totals.chunks)} chunks, ${String(preview.totals.embeddingTokens)} estimated embedding tokens`,
  );
  const provider = embeddingProviderFromEnv();
  const cancellation = cliCancellation();
  try {
    const result = await withKnowledgeTenant(values.tenant, (tx) =>
      new KnowledgeIngestor(new PostgresIngestStore(tx), provider).ingest(
        preview,
        cancellation.signal,
        {
          batchSize: Number(process.env.AI_EMBEDDING_BATCH_SIZE ?? 32),
          concurrency: Number(process.env.AI_EMBEDDING_CONCURRENCY ?? 2),
        },
      ),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cancellation.dispose();
  }
}
void main().catch((error: unknown) => {
  // Prisma errors can contain SQL/content; never print arbitrary exception objects.
  console.error(
    error instanceof EmbeddingRequestError
      ? error.code
      : 'Ingest failed; check arguments, tenant, database/migrations and embedding configuration.',
  );
  process.exitCode = 1;
});
