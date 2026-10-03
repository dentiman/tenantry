import { randomUUID } from 'node:crypto';
import type { Prisma, TenantTransactions } from '@saas-skeleton/database';
import { KNOWLEDGE_EMBEDDING_MODEL } from '../embedding-provider';
import { ftsConfigFor, type FtsConfig } from '../fts';
import type { SourcePreview } from './preview';
import type { PreviewChunk } from './chunker';

export interface IngestRun {
  sourceId: string;
  runId: string;
  unchanged: boolean;
}
export interface StagedChunk {
  documentId: string;
  /** За мовою документа (AI-2a.4): від неї залежить стемінг `search_vector` */
  ftsConfig: FtsConfig;
  chunk: PreviewChunk;
}

/** All reads/writes, including locks and caches, run under the caller's tenant RLS. */
export class PostgresIngestStore {
  constructor(private readonly transactions: TenantTransactions) {}

  async begin(preview: SourcePreview): Promise<IngestRun> {
    return this.transactions.withTenantTx(async (tx) => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO ai_knowledge_sources (id, key, product, updated_at)
        VALUES (${id}, ${preview.sourceKey}, ${preview.product}, NOW())
        ON CONFLICT (tenant_id, product, key) DO NOTHING`;
      const [source] = await tx.$queryRaw<
        { id: string; activeRevision: string | null; isEnabled: boolean }[]
      >`
        SELECT id, active_revision AS "activeRevision", is_enabled AS "isEnabled"
        FROM ai_knowledge_sources WHERE product = ${preview.product} AND key = ${preview.sourceKey} FOR UPDATE`;
      if (!source) throw new Error('Knowledge source unavailable in tenant context');
      const runId = randomUUID();
      const unchanged = source.activeRevision === preview.revision && source.isEnabled;
      await tx.aiKnowledgeSource.update({
        where: { id: source.id },
        data: {
          ingestRunId: runId,
          ingestStatus: unchanged ? 'complete' : 'running',
          ingestStartedAt: new Date(),
        },
      });
      return { sourceId: source.id, runId, unchanged };
    });
  }

  private async own(tx: Prisma.TransactionClient, run: IngestRun): Promise<void> {
    const [source] = await tx.$queryRaw<{ runId: string | null; status: string }[]>`
      SELECT ingest_run_id AS "runId", ingest_status AS status FROM ai_knowledge_sources
      WHERE id = ${run.sourceId} FOR UPDATE`;
    if (source?.runId !== run.runId || source.status !== 'running')
      throw new Error('Ingest run superseded');
  }

  async cached(run: IngestRun): Promise<Map<string, string>> {
    return this.transactions.withTenantTx(async (tx) => {
      await this.own(tx, run);
      const rows = await tx.$queryRaw<{ hash: string; vector: string }[]>`
        SELECT DISTINCT ON (c.content_hash) c.content_hash AS hash, c.embedding::text AS vector
        FROM ai_knowledge_chunks c JOIN ai_knowledge_documents d
          ON d.id = c.document_id AND d.tenant_id = c.tenant_id
        WHERE d.source_id = ${run.sourceId} AND c.embedding_model = ${KNOWLEDGE_EMBEDDING_MODEL}
        ORDER BY c.content_hash, c.id`;
      return new Map(rows.map((row) => [row.hash, row.vector]));
    });
  }

  async stage(run: IngestRun, preview: SourcePreview): Promise<StagedChunk[]> {
    return this.transactions.withTenantTx(async (tx) => {
      await this.own(tx, run);
      const docs = preview.documents.map((doc) => ({ id: randomUUID(), doc }));
      await tx.aiKnowledgeDocument.createMany({
        data: docs.map(({ id, doc }) => ({
          id,
          sourceId: run.sourceId,
          revision: run.runId,
          canonicalId: doc.canonicalId,
          path: doc.path,
          title: doc.title,
          language: doc.language,
          audience: doc.audience,
          contentHash: doc.contentHash,
        })),
      });
      return docs.flatMap(({ id, doc }) =>
        doc.chunks.map((chunk) => ({
          documentId: id,
          ftsConfig: ftsConfigFor(doc.language),
          chunk,
        })),
      );
    });
  }

  async write(
    run: IngestRun,
    rows: readonly StagedChunk[],
    vectors: ReadonlyMap<string, string>,
  ): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await this.own(tx, run);
      for (const { documentId, ftsConfig, chunk } of rows) {
        const vector = vectors.get(chunk.contentHash);
        if (!vector) throw new Error('Missing embedding for staged chunk');
        await tx.$executeRaw`
          INSERT INTO ai_knowledge_chunks
            (id, document_id, ordinal, heading, content, content_hash, token_count, embedding_model, embedding, fts_config)
          VALUES (${randomUUID()}, ${documentId}, ${chunk.ordinal}, ${chunk.heading}, ${chunk.content},
            ${chunk.contentHash}, ${chunk.tokenCount}, ${KNOWLEDGE_EMBEDDING_MODEL}, ${vector}::vector(1536),
            ${ftsConfig}::regconfig)`;
      }
    });
  }

  async publish(run: IngestRun, preview: SourcePreview): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await this.own(tx, run);
      const documents = await tx.aiKnowledgeDocument.count({
        where: { sourceId: run.sourceId, revision: run.runId },
      });
      const chunks = await tx.aiKnowledgeChunk.count({
        where: { document: { sourceId: run.sourceId, revision: run.runId } },
      });
      if (documents !== preview.totals.documents || chunks !== preview.totals.chunks)
        throw new Error('Incomplete ingest snapshot');
      // Lock ownership prevents late writers; deletion and pointer swap are atomic.
      await tx.aiKnowledgeDocument.deleteMany({
        where: { sourceId: run.sourceId, revision: { not: run.runId } },
      });
      await tx.aiKnowledgeDocument.updateMany({
        where: { sourceId: run.sourceId, revision: run.runId },
        data: { revision: preview.revision },
      });
      await tx.aiKnowledgeSource.update({
        where: { id: run.sourceId },
        data: {
          activeRevision: preview.revision,
          isEnabled: true,
          ingestStatus: 'complete',
          manifestHash: preview.manifestHash,
        },
      });
    });
  }

  async fail(run: IngestRun): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await tx.aiKnowledgeSource.updateMany({
        where: { id: run.sourceId, ingestRunId: run.runId, ingestStatus: 'running' },
        data: { ingestStatus: 'failed' },
      });
    });
  }
}
