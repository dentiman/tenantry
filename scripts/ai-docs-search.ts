import '../libs/database/load-root-env';
import { parseArgs } from 'node:util';
import {
  cliCancellation,
  requireEmbeddingProvider,
  withKnowledgeTenant,
} from '../libs/shared/src/ai/knowledge/cli-runtime';
import { PostgresKnowledgeStore } from '../libs/shared/src/ai/knowledge/postgres-knowledge-store';
import { countTokens } from '../libs/shared/src/ai/knowledge/ingest/chunker';
import { EmbeddingRequestError } from '../libs/shared/src/ai/knowledge/openai-embedding-provider';
import { RecordingEmbeddingProvider } from '../libs/shared/src/ai/knowledge/recording-embedding-provider';
import { AiUsageLedger } from '../libs/shared/src/ai/costs/usage-ledger';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      tenant: { type: 'string' },
      role: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'string', default: '5' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'pnpm ai:docs:search --product fms --tenant <id-or-slug> --role ADMIN --query "..." [--limit 5]',
    );
    return;
  }
  const { role, query, product, tenant } = values;
  const limit = Number(values.limit);
  if (
    !tenant ||
    !product?.trim() ||
    !query?.trim() ||
    !['ADMIN', 'USER'].includes(role ?? '') ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    query.length > 16_000 ||
    countTokens(query) > 2048
  )
    throw new Error('Invalid search arguments');
  // Narrow rather than cast an unvalidated CLI role.
  if (role !== 'ADMIN' && role !== 'USER') throw new Error('Invalid role');
  const provider = requireEmbeddingProvider();
  const cancellation = cliCancellation();
  try {
    const result = await withKnowledgeTenant(tenant, async (tx) => {
      // AI-5b: операторський пошук теж платний — рядок журналу `eval` під цим tenant-ом
      const recorded = new RecordingEmbeddingProvider(provider, tx, new AiUsageLedger(), {
        kind: 'eval',
        sourceId: 'ai:docs:search',
      });
      const embedding = await recorded.embed([query], cancellation.signal);
      const items = await new PostgresKnowledgeStore(tx).search({
        product,
        role,
        limit,
        embeddingModel: embedding.model,
        embedding: embedding.vectors[0] ?? [],
      });
      return { inputTokens: embedding.inputTokens, items };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cancellation.dispose();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof EmbeddingRequestError
      ? error.code
      : 'Search failed; check arguments, tenant, database/migrations and embedding configuration.',
  );
  process.exitCode = 1;
});
