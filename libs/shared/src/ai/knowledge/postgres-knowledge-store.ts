import { Injectable } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import type { AiUserContext } from '../prompt/prompt-builder';
import { serializeKnowledgeVector } from './embedding-provider';
import { FTS_CONFIG_LIST } from './fts';

/** Internal retrieval input, not an HTTP contract. Tenant comes exclusively from CLS. */
export interface KnowledgeVectorQuery {
  readonly product: string;
  readonly role: AiUserContext['role'];
  readonly embeddingModel: string;
  readonly embedding: readonly number[];
  readonly limit: number;
}

/** Внутрішній вхід FTS-пошуку (AI-2a.4) — той самий scope, що й у vector, без embedding */
export interface KnowledgeTextQuery {
  readonly product: string;
  readonly role: AiUserContext['role'];
  readonly text: string;
  readonly limit: number;
}

export interface KnowledgeChunkCandidate {
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
  readonly contentHash: string;
  readonly tokenCount: number;
}

export interface KnowledgeChunkMatch extends KnowledgeChunkCandidate {
  /** Cosine distance: smaller is closer. Not a calibrated confidence score. */
  readonly distance: number;
}

export interface KnowledgeTextMatch extends KnowledgeChunkCandidate {
  /** `ts_rank_cd`, нормований за довжиною: більше — краще; залежить від довжини питання */
  readonly textRank: number;
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
             c.heading, c.content, c.content_hash AS "contentHash", c.token_count AS "tokenCount",
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

  /**
   * Full-text пошук (AI-2a.4, design.md D2): АБО лексем питання для кожної конфігурації,
   * з якою проіндексовано чанки, ранжування `ts_rank_cd` із нормуванням за довжиною.
   * AND (`plainto_tsquery` як є) майже ніколи не збігся б із питанням природною мовою.
   * Фільтри product/публікації/ролі й RLS — ті самі, що в `search()`.
   */
  searchText(query: KnowledgeTextQuery): Promise<KnowledgeTextMatch[]> {
    if (
      !query.product.trim() ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 50
    ) {
      throw new Error('Knowledge search requires a product and an integer limit between 1 and 50');
    }
    const configs = [...FTS_CONFIG_LIST];
    return this.tenantTx.withTenantTx(
      (tx) => tx.$queryRaw<KnowledgeTextMatch[]>`
      WITH q AS (
        SELECT cfg, replace(plainto_tsquery(cfg, ${query.text})::text, ' & ', ' | ')::tsquery AS query
        FROM unnest(${configs}::regconfig[]) AS cfg
      )
      SELECT c.id AS "chunkId", d.id AS "documentId", s.key AS "sourceKey",
             d.revision, d.canonical_id AS "canonicalId", d.path, d.title, d.language,
             c.heading, c.content, c.content_hash AS "contentHash", c.token_count AS "tokenCount",
             ts_rank_cd(c.search_vector, q.query, 1) AS "textRank"
      FROM ai_knowledge_chunks c
      JOIN q ON q.cfg = c.fts_config
      JOIN ai_knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      JOIN ai_knowledge_sources s ON s.tenant_id = d.tenant_id AND s.id = d.source_id
      WHERE s.product = ${query.product}
        AND s.is_enabled = true
        AND d.revision = s.active_revision
        AND ${query.role}::"Role" = ANY(d.audience)
        AND c.search_vector @@ q.query
      ORDER BY "textRank" DESC, c.id ASC
      LIMIT ${query.limit}
    `,
    );
  }

  /**
   * Текст цитати при ВІДКРИТТІ (AI-2a.3, design.md D8): права перевіряються заново, а не
   * беруться з моменту відповіді. Фрагмент мусить бути в опублікованій ревізії
   * увімкненого джерела й видимий ролі. Після переіндексування `chunkId` інший, тому
   * запасний шлях — той самий текст (`content_hash`) у тому ж джерелі.
   */
  async findCitation(query: {
    readonly chunkId: string;
    readonly sourceKey: string;
    readonly contentHash: string;
    readonly role: AiUserContext['role'];
  }): Promise<KnowledgeCitationText | null> {
    const rows = await this.tenantTx.withTenantTx(
      (tx) => tx.$queryRaw<KnowledgeCitationText[]>`
      SELECT d.title, d.path, c.heading, c.content, d.revision
      FROM ai_knowledge_chunks c
      JOIN ai_knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      JOIN ai_knowledge_sources s ON s.tenant_id = d.tenant_id AND s.id = d.source_id
      WHERE (c.id = ${query.chunkId}
             OR (c.content_hash = ${query.contentHash} AND s.key = ${query.sourceKey}))
        AND s.is_enabled = true
        AND d.revision = s.active_revision
        AND ${query.role}::"Role" = ANY(d.audience)
      ORDER BY (c.id = ${query.chunkId}) DESC, c.id ASC
      LIMIT 1
    `,
    );
    return rows[0] ?? null;
  }
}

export interface KnowledgeCitationText {
  readonly title: string;
  readonly path: string;
  readonly heading: string;
  readonly content: string;
  readonly revision: string;
}
