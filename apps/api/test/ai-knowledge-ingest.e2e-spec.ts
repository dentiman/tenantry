/// <reference types="jest" />
import { createHash } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaModule,
  SystemPrismaModule, SystemPrismaService,
  TenancyModule,
  TenantContextService,
  TenantTransactions,
  type Role,
} from '@saas-skeleton/database';
import {
  KNOWLEDGE_EMBEDDING_MODEL,
  PostgresKnowledgeStore,
  type EmbeddingBatch,
  type EmbeddingProvider,
} from '@saas-skeleton/shared';
// Not in the runtime barrel: the ingest folder also holds the ESM-only Markdown parser.
// These two files import only types from it, so Jest can load them directly.
import { KnowledgeIngestor } from '../../../libs/shared/src/ai/knowledge/ingest/knowledge-ingestor';
import { PostgresIngestStore } from '../../../libs/shared/src/ai/knowledge/ingest/postgres-ingest-store';
import type { SourcePreview } from '../../../libs/shared/src/ai/knowledge/ingest/preview';

const tenantA = 'knowledge-ingest-a';
const tenantB = 'knowledge-ingest-b';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Deterministic, nonzero 1536-d vector per text: closer texts share the leading word. */
function fakeVector(text: string): number[] {
  const out = Array<number>(1536).fill(0);
  const word = text.split(/\s+/)[0] ?? '';
  out[parseInt(sha(word).slice(0, 4), 16) % 1536] = 1;
  const detail = parseInt(sha(text).slice(0, 4), 16) % 1536;
  out[detail] = (out[detail] ?? 0) + 0.1;
  return out;
}

class FakeProvider implements EmbeddingProvider {
  calls: string[][] = [];
  failOnCall?: number;

  embed(texts: readonly string[]): Promise<EmbeddingBatch> {
    this.calls.push([...texts]);
    if (this.failOnCall === this.calls.length) {
      return Promise.reject(new Error('provider down'));
    }
    return Promise.resolve({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      vectors: texts.map(fakeVector),
      inputTokens: texts.length * 3,
    });
  }

  get texts(): number {
    return this.calls.reduce((sum, batch) => sum + batch.length, 0);
  }
}

interface DocSpec {
  id: string;
  audience?: ('ADMIN' | 'USER')[];
  chunks: string[];
}

function preview(revision: string, docs: DocSpec[], product = 'fms'): SourcePreview {
  const documents = docs.map((doc) => ({
    path: `010_business/${doc.id}.md`,
    canonicalId: doc.id,
    title: doc.id,
    language: 'en',
    audience: doc.audience ?? ['ADMIN', 'USER'],
    fileHash: sha(doc.chunks.join('|')),
    contentHash: sha(doc.chunks.join('|')),
    chunks: doc.chunks.map((content, ordinal) => ({
      ordinal,
      heading: doc.id,
      content,
      embeddingText: content,
      contentHash: sha(content),
      tokenCount: 3,
    })),
  }));
  const chunks = documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
  return {
    sourceKey: 'fms',
    product,
    revision,
    manifestHash: sha('manifest'),
    parserVersion: 'test',
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    dimensions: 1536,
    tokenizer: 'cl100k_base',
    documents,
    rejected: [],
    totals: { documents: documents.length, rejected: 0, chunks, embeddingTokens: chunks * 3 },
  };
}

const V1: DocSpec[] = [
  { id: 'billing', chunks: ['billing invoices are monthly', 'billing refunds take a week'] },
  { id: 'roles', audience: ['ADMIN'], chunks: ['roles admins manage users'] },
];

describe('Knowledge ingest (real Postgres, tenant RLS, fake embeddings)', () => {
  let module: TestingModule;
  let system: SystemPrismaService;
  let context: TenantContextService;
  let transactions: TenantTransactions;
  let search: PostgresKnowledgeStore;
  const signal = new AbortController().signal;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TenancyModule.forRoot(), PrismaModule, SystemPrismaModule],
      providers: [PostgresKnowledgeStore],
    }).compile();
    await module.init();
    system = module.get(SystemPrismaService);
    context = module.get(TenantContextService);
    transactions = module.get(TenantTransactions);
    search = module.get(PostgresKnowledgeStore);
    for (const id of [tenantA, tenantB]) {
      await system.tenant.upsert({ where: { id }, create: { id, slug: id, name: id }, update: {} });
    }
  });

  beforeEach(async () => {
    await system.aiKnowledgeSource.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  });

  afterAll(async () => {
    await system.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await module.close();
  });

  const store = (): PostgresIngestStore => new PostgresIngestStore(transactions);
  const ingest = (tenant: string, snapshot: SourcePreview, provider: FakeProvider, batchSize = 1) =>
    context.runWith(tenant, () =>
      new KnowledgeIngestor(store(), provider).ingest(snapshot, signal, {
        batchSize,
        concurrency: 1,
      }),
    );
  const find = (tenant: string, query: string, role: Role = 'ADMIN', product = 'fms') =>
    context.runWith(tenant, () =>
      search.search({
        product,
        role,
        limit: 10,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        embedding: fakeVector(query),
      }),
    );
  const source = (tenant: string) =>
    system.aiKnowledgeSource.findFirstOrThrow({ where: { tenantId: tenant, key: 'fms' } });
  const documentCount = (tenant: string) =>
    system.aiKnowledgeDocument.count({ where: { tenantId: tenant } });

  it('publishes a complete snapshot that search can read, filtered by role', async () => {
    const provider = new FakeProvider();
    const result = await ingest(tenantA, preview('r1', V1), provider);
    expect(result).toMatchObject({ unchanged: false, documents: 2, chunks: 3, embeddedTexts: 3 });
    expect(await source(tenantA)).toMatchObject({
      activeRevision: 'r1',
      isEnabled: true,
      ingestStatus: 'complete',
    });

    const admin = await find(tenantA, 'billing refunds take a week');
    expect(admin[0]).toMatchObject({ canonicalId: 'billing', revision: 'r1' });
    expect(admin.map((m) => m.canonicalId).sort()).toEqual(['billing', 'billing', 'roles']);
    const user = await find(tenantA, 'roles admins manage users', 'USER');
    expect(user.map((m) => m.canonicalId)).not.toContain('roles');
  });

  it('returns no content for a role without permitted documents', async () => {
    await ingest(
      tenantA,
      preview('r1', [{ id: 'roles', audience: ['ADMIN'], chunks: ['x y'] }]),
      new FakeProvider(),
    );
    expect(await find(tenantA, 'x y', 'USER')).toEqual([]);
  });

  it('makes zero embedding calls when the active revision already matches', async () => {
    await ingest(tenantA, preview('r1', V1), new FakeProvider());
    const repeat = new FakeProvider();
    const result = await ingest(tenantA, preview('r1', V1), repeat);
    expect(result).toMatchObject({ unchanged: true, embeddedTexts: 0, reusedChunks: 3 });
    expect(repeat.calls).toEqual([]);
  });

  it('embeds only changed chunks and replaces the previous revision', async () => {
    await ingest(tenantA, preview('r1', V1), new FakeProvider());
    const changed = structuredClone(V1);
    changed[0] = {
      id: 'billing',
      chunks: ['billing invoices are monthly', 'billing refunds take 3 days'],
    };
    const provider = new FakeProvider();
    const result = await ingest(tenantA, preview('r2', changed), provider);
    expect(provider.calls).toEqual([['billing refunds take 3 days']]);
    expect(result).toMatchObject({ embeddedTexts: 1, reusedChunks: 2 });
    expect(await documentCount(tenantA)).toBe(2);
    const matches = await find(tenantA, 'billing refunds take 3 days');
    expect(matches.every((m) => m.revision === 'r2')).toBe(true);
    expect(matches.map((m) => m.content)).not.toContain('billing refunds take a week');
  });

  it('keeps the published revision searchable when embedding fails, then resumes', async () => {
    await ingest(tenantA, preview('r1', V1), new FakeProvider());
    const next: DocSpec[] = [
      ...V1,
      { id: 'tickets', chunks: ['tickets one', 'tickets two', 'tickets three'] },
    ];

    const failing = new FakeProvider();
    failing.failOnCall = 2;
    await expect(ingest(tenantA, preview('r2', next), failing)).rejects.toThrow('provider down');
    expect(await source(tenantA)).toMatchObject({ activeRevision: 'r1', ingestStatus: 'failed' });
    const during = await find(tenantA, 'tickets one');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((m) => m.revision === 'r1')).toBe(true);

    // The first new chunk was checkpointed before the failure; only two remain.
    const retry = new FakeProvider();
    const result = await ingest(tenantA, preview('r2', next), retry);
    expect(retry.texts).toBe(2);
    expect(result).toMatchObject({ embeddedTexts: 2, reusedChunks: 4 });
    expect(await source(tenantA)).toMatchObject({ activeRevision: 'r2', ingestStatus: 'complete' });
    // Publication removed both the old revision and the failed run's staging rows.
    expect(await documentCount(tenantA)).toBe(3);
    expect((await find(tenantA, 'tickets one'))[0]).toMatchObject({
      canonicalId: 'tickets',
      revision: 'r2',
    });
  });

  it('a superseded run can neither write nor publish', async () => {
    const snapshot = preview('r1', V1);
    await context.runWith(tenantA, async () => {
      const older = await store().begin(snapshot);
      const rows = await store().stage(older, snapshot);
      const newer = await store().begin(snapshot);
      const vectors = new Map(
        rows.map((r) => [r.chunk.contentHash, JSON.stringify(fakeVector(r.chunk.content))]),
      );
      await expect(store().write(older, rows, vectors)).rejects.toThrow('Ingest run superseded');
      await expect(store().publish(older, snapshot)).rejects.toThrow('Ingest run superseded');
      expect(newer.runId).not.toBe(older.runId);
    });
    expect(await source(tenantA)).toMatchObject({ activeRevision: null, ingestStatus: 'running' });
    expect(await find(tenantA, 'billing invoices are monthly')).toEqual([]);
  });

  it('rejects publication of an incomplete snapshot', async () => {
    const snapshot = preview('r1', V1);
    await context.runWith(tenantA, async () => {
      const run = await store().begin(snapshot);
      await store().stage(run, snapshot);
      await expect(store().publish(run, snapshot)).rejects.toThrow('Incomplete ingest snapshot');
    });
    expect((await source(tenantA)).activeRevision).toBeNull();
  });

  it('never reuses or exposes embeddings across tenants', async () => {
    await ingest(tenantA, preview('r1', V1), new FakeProvider());
    const other = new FakeProvider();
    await ingest(tenantB, preview('r1', V1), other);
    expect(other.texts).toBe(3); // same content, but A's vectors are invisible under B's RLS

    await ingest(
      tenantB,
      preview('b1', [{ id: 'secret', chunks: ['secret b only'] }], 'other'),
      new FakeProvider(),
    );
    expect(await find(tenantA, 'secret b only', 'ADMIN', 'other')).toEqual([]);
    expect(await find(tenantB, 'secret b only', 'ADMIN', 'other')).toHaveLength(1);
  });

  it('sets the full-text configuration from the document language', async () => {
    const snapshot = preview('r1', [
      { id: 'en-doc', chunks: ['billing invoices'] },
      { id: 'uk-doc', chunks: ['гаманець клієнта'] },
    ]);
    const ukDoc = snapshot.documents[1];
    if (ukDoc) ukDoc.language = 'uk';
    await ingest(tenantA, snapshot, new FakeProvider());
    const rows = await system.$queryRaw<{ language: string; config: string; indexed: boolean }[]>`
      SELECT d.language, c.fts_config::text AS config, c.search_vector IS NOT NULL AS indexed
      FROM ai_knowledge_chunks c JOIN ai_knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${tenantA} ORDER BY d.language`;
    expect(rows).toEqual([
      { language: 'en', config: 'english', indexed: true },
      { language: 'uk', config: 'simple', indexed: true },
    ]);
  });

  it('rejects an invalid or empty snapshot before touching the database', async () => {
    const provider = new FakeProvider();
    await expect(ingest(tenantA, preview('r1', []), provider)).rejects.toThrow('Invalid or empty');
    const wrongTotals = {
      ...preview('r1', V1),
      totals: { documents: 2, rejected: 0, chunks: 9, embeddingTokens: 0 },
    };
    await expect(ingest(tenantA, wrongTotals, provider)).rejects.toThrow('Invalid or empty');
    expect(await system.aiKnowledgeSource.count({ where: { tenantId: tenantA } })).toBe(0);
  });
});
