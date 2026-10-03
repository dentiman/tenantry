import { Logger } from '@nestjs/common';
import type { EmbeddingProvider } from './embedding-provider';
import type { KnowledgeExcerpt } from './citations';
import type { KnowledgeQuery, KnowledgeSelection, KnowledgeSource } from './knowledge-source';
import type { KnowledgeChunkMatch, PostgresKnowledgeStore } from './postgres-knowledge-store';

export interface PostgresKnowledgeOptions {
  /** `product` у `ai_knowledge_sources` — задає інсталяція, а не користувач */
  readonly product: string;
  readonly vectorCandidates: number;
  readonly finalChunks: number;
  readonly maxContextTokens: number;
}

/**
 * Запас токенів на мітку фрагмента в промпті (номер, назва, розділ, шлях) понад
 * збережений `token_count`, який уже включає breadcrumb заголовків.
 */
export const EXCERPT_LABEL_TOKENS = 24;

/**
 * Retrieval з опублікованого pgvector-індексу (AI-2a.3, design.md D1/D2).
 *
 * Embedding питання — HTTP-виклик, тому `select()` НЕ можна викликати всередині
 * чужої транзакції (design.md D3): пошук відкриває власну коротку tenant-транзакцію
 * вже після відповіді провайдера. Тенант — лише з CLS, роль — від викликача.
 */
export class PostgresKnowledgeSource implements KnowledgeSource {
  private readonly logger = new Logger(PostgresKnowledgeSource.name);

  constructor(
    private readonly store: Pick<PostgresKnowledgeStore, 'search'>,
    private readonly embeddings: EmbeddingProvider,
    private readonly options: PostgresKnowledgeOptions,
  ) {}

  async select(query: KnowledgeQuery): Promise<KnowledgeSelection> {
    const startedAt = Date.now();
    // Провайдер обмежує себе власним timeout/retry; скасування ззовні тут немає
    const embedding = await this.embeddings.embed([query.question], new AbortController().signal);
    const matches = await this.store.search({
      product: this.options.product,
      role: query.role,
      limit: this.options.vectorCandidates,
      embeddingModel: embedding.model,
      embedding: embedding.vectors[0] ?? [],
    });
    const excerpts = selectExcerpts(matches, this.options);
    // Лише числа: ні питання, ні тексту фрагментів
    this.logger.log(
      {
        product: this.options.product,
        queryTokens: embedding.inputTokens,
        candidates: matches.length,
        excerpts: excerpts.length,
        contextTokens: excerpts.reduce((sum, e) => sum + e.tokenCount, 0),
        latencyMs: Date.now() - startedAt,
      },
      'AI knowledge retrieval',
    );
    return {
      version: knowledgeVersion(this.options.product, excerpts),
      documents: [],
      excerpts: excerpts.map(({ tokenCount: _tokenCount, ...excerpt }) => excerpt),
    };
  }
}

/**
 * Відбір у порядку distance (design.md D2): однакові тексти — один раз; фрагмент, що
 * не вміщується в бюджет, пропускається, але менший наступний ще може увійти.
 */
export function selectExcerpts(
  matches: readonly KnowledgeChunkMatch[],
  options: Pick<PostgresKnowledgeOptions, 'finalChunks' | 'maxContextTokens'>,
): (KnowledgeExcerpt & { readonly tokenCount: number })[] {
  const seen = new Set<string>();
  const selected: (KnowledgeExcerpt & { readonly tokenCount: number })[] = [];
  let budget = options.maxContextTokens;
  for (const match of matches) {
    if (selected.length >= options.finalChunks) break;
    if (seen.has(match.content)) continue;
    const cost = match.tokenCount + EXCERPT_LABEL_TOKENS;
    if (cost > budget) continue;
    seen.add(match.content);
    budget -= cost;
    selected.push({
      n: selected.length + 1,
      chunkId: match.chunkId,
      documentId: match.documentId,
      sourceKey: match.sourceKey,
      revision: match.revision,
      title: match.title,
      path: match.path,
      heading: match.heading,
      contentHash: match.contentHash,
      content: match.content,
      tokenCount: cost,
    });
  }
  return selected;
}

/** `postgres:<product>:<sourceKey@revision,…>` відібраних фрагментів (design.md D6) */
export function knowledgeVersion(product: string, excerpts: readonly KnowledgeExcerpt[]): string {
  const revisions = [...new Set(excerpts.map((e) => `${e.sourceKey}@${e.revision}`))].sort();
  return `postgres:${product}:${revisions.length > 0 ? revisions.join(',') : 'none'}`;
}
