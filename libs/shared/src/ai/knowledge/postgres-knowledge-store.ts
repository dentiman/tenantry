import { Injectable } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import type { AiUserContext } from '../prompt/prompt-builder';
import { serializeKnowledgeVector } from './embedding-provider';

/** Internal retrieval input, not an HTTP contract. Tenant comes exclusively from CLS. */
export interface KnowledgeVectorQuery {
  readonly product: string;
  readonly role: AiUserContext['role'];
  readonly embeddingModel: string;
  readonly embedding: readonly number[];
  readonly limit: number;
}

export interface KnowledgeChunkMatch {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourceKey: string;
  readonly revision: string;
  readonly canonicalId: string;
  readonly path: string;
  readonly title: string;
  readonly language: string;
  readonly heading: string;
  readonly content: string;
  readonly tokenCount: number;
  /** Cosine distance: smaller is closer. Not a calibrated confidence score. */
  readonly distance: number;
}

/**
 * Exact pgvector search for the first corpus. RLS scopes all three joined tables;
 * product, audience, enabled state and published revision are checked on every call.
 * No LLM/network call happens while the tenant transaction holds a connection.
 */
@Injectable()
export class PostgresKnowledgeStore {
  constructor(private readonly tenantTx: TenantTransactions) {}

  search(query: KnowledgeVectorQuery): Promise<KnowledgeChunkMatch[]> {
    if (
      !query.product.trim() ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 50
    ) {
      throw new Error('Knowledge search requires a product and an integer limit between 1 and 50');
    }
    const vector = serializeKnowledgeVector(query.embeddingModel, query.embedding);
    return this.tenantTx.withTenantTx(
      (tx) => tx.$queryRaw<KnowledgeChunkMatch[]>`
      SELECT c.id AS "chunkId", d.id AS "documentId", s.key AS "sourceKey",
             d.revision, d.canonical_id AS "canonicalId", d.path, d.title, d.language,
             c.heading, c.content, c.token_count AS "tokenCount",
             (c.embedding <=> ${vector}::vector(1536)) AS distance
      FROM ai_knowledge_chunks c
      JOIN ai_knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      JOIN ai_knowledge_sources s ON s.tenant_id = d.tenant_id AND s.id = d.source_id
      WHERE s.product = ${query.product}
        AND s.is_enabled = true
        AND d.revision = s.active_revision
        AND ${query.role}::"Role" = ANY(d.audience)
        AND c.embedding_model = ${query.embeddingModel}
      ORDER BY distance ASC, c.id ASC
      LIMIT ${query.limit}
    `,
    );
  }
}
