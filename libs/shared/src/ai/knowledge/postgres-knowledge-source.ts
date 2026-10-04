import { Logger } from '@nestjs/common';
import type { EmbeddingProvider } from './embedding-provider';
import type { KnowledgeExcerpt } from './citations';
import type {
  KnowledgeQuery,
  KnowledgeSelection,
  KnowledgeSource,
  QueryEmbeddingUsage,
} from './knowledge-source';
import type {
  KnowledgeChunkCandidate,
  KnowledgeChunkMatch,
  KnowledgeTextMatch,
  PostgresKnowledgeStore,
} from './postgres-knowledge-store';

/**
 * Режим пошуку (AI-2a.4, design.md D3/D5): `vector` — cosine distance; `fts` — Postgres
 * full-text без embedding-виклику; `hybrid` — обидва списки, злиті за RRF.
 */
export type KnowledgeSearchMode = 'vector' | 'fts' | 'hybrid';

export interface PostgresKnowledgeOptions {
  /** `product` у `ai_knowledge_sources` — задає інсталяція, а не користувач */
  readonly product: string;
  readonly mode: KnowledgeSearchMode;
  readonly vectorCandidates: number;
  readonly textCandidates: number;
  readonly finalChunks: number;
  readonly maxContextTokens: number;
  /** Поріг cosine distance для vector-гілки; `null` — без порогу (design.md D4) */
  readonly maxDistance: number | null;
}

/**
 * Запас токенів на мітку фрагмента в промпті (номер, назва, розділ, шлях) понад
 * збережений `token_count`, який уже включає breadcrumb заголовків.
 */
export const EXCERPT_LABEL_TOKENS = 24;

/** Константа RRF (Cormack et al.): гасить вагу перших позицій, 60 — усталене значення */
export const RRF_K = 60;

export type SelectedExcerpt = KnowledgeExcerpt & { readonly tokenCount: number };

/** Повний результат retrieval — для `select()` і для eval (`pnpm ai:docs:eval`) */
export interface KnowledgeRetrieval {
  readonly excerpts: SelectedExcerpt[];
  /** Сирі списки гілок до порогу й злиття — щоб eval бачив distance і ранги */
  readonly vector: readonly KnowledgeChunkMatch[];
  readonly text: readonly KnowledgeTextMatch[];
  readonly queryTokens: number;
  /** Платний embedding питання для журналу витрат (AI-5b); `null` — виклику не було */
  readonly queryEmbedding: QueryEmbeddingUsage | null;
  /** `hybrid` без embeddings (провайдер недоступний) — відповідали лише з FTS */
  readonly degraded: boolean;
  readonly embedMs: number;
  readonly searchMs: number;
}

/**
 * Retrieval з опублікованого pgvector/FTS-індексу (AI-2a.3, AI-2a.4).
 *
 * Embedding питання — HTTP-виклик, тому `select()` НЕ можна викликати всередині
 * чужої транзакції (AI-2a.3 design.md D3): кожен пошук відкриває власну коротку
 * tenant-транзакцію. Тенант — лише з CLS, роль — від викликача.
 */
export class PostgresKnowledgeSource implements KnowledgeSource {
  private readonly logger = new Logger(PostgresKnowledgeSource.name);

  constructor(
    private readonly store: Pick<PostgresKnowledgeStore, 'search' | 'searchText'>,
    private readonly embeddings: EmbeddingProvider,
    private readonly options: PostgresKnowledgeOptions,
  ) {}

  async select(query: KnowledgeQuery): Promise<KnowledgeSelection> {
    const result = await this.retrieve(query);
    // Лише числа: ні питання, ні тексту фрагментів
    this.logger.log(
      {
        product: this.options.product,
        mode: this.options.mode,
        degraded: result.degraded,
        queryTokens: result.queryTokens,
        vectorCandidates: result.vector.length,
        textCandidates: result.text.length,
        excerpts: result.excerpts.length,
        contextTokens: result.excerpts.reduce((sum, e) => sum + e.tokenCount, 0),
        latencyMs: result.embedMs + result.searchMs,
      },
      'AI knowledge retrieval',
    );
    return selectionFromRetrieval(this.options.product, result);
  }

  async retrieve(query: KnowledgeQuery): Promise<KnowledgeRetrieval> {
    const { mode, product } = this.options;
    let embedding: {
      model: string;
      vector: readonly number[];
      tokens: number;
      usage: QueryEmbeddingUsage;
    } | null = null;
    let degraded = false;
    const embedStartedAt = Date.now();
    if (mode !== 'fts') {
      try {
        // Провайдер обмежує себе власним timeout/retry; скасування ззовні тут немає
        const batch = await this.embeddings.embed([query.question], new AbortController().signal);
        embedding = {
          model: batch.model,
          vector: batch.vectors[0] ?? [],
          tokens: batch.inputTokens,
          usage: {
            inputTokens: batch.inputTokens,
            ...(batch.billing ? { billing: batch.billing } : {}),
          },
        };
      } catch (error) {
        // `vector` без embeddings відповідати не може — явна помилка (AI-2a.3 D4);
        // `hybrid` переходить на FTS і каже про це в лозі (design.md D5)
        if (mode === 'vector') throw error;
        degraded = true;
        this.logger.warn(
          { product, err: error instanceof Error ? error.message : 'unknown' },
          'AI knowledge retrieval degraded to full-text search',
        );
      }
    }
    const embedMs = Date.now() - embedStartedAt;

    const searchStartedAt = Date.now();
    const [vector, text] = await Promise.all([
      embedding
        ? this.store.search({
            product,
            role: query.role,
            limit: this.options.vectorCandidates,
            embeddingModel: embedding.model,
            embedding: embedding.vector,
          })
        : Promise.resolve([]),
      mode === 'vector'
        ? Promise.resolve([])
        : this.store.searchText({
            product,
            role: query.role,
            limit: this.options.textCandidates,
            text: query.question,
          }),
    ]);
    const searchMs = Date.now() - searchStartedAt;

    const ranked = rankCandidates(mode, vector, text, this.options.maxDistance);
    return {
      excerpts: selectExcerpts(ranked, this.options),
      vector,
      text,
      queryTokens: embedding?.tokens ?? 0,
      queryEmbedding: embedding?.usage ?? null,
      degraded,
      embedMs,
      searchMs,
    };
  }
}

/**
 * Порядок кандидатів для відбору (design.md D3/D4). Поріг distance — лише для
 * vector-гілки; `hybrid` зливає її з FTS за RRF: внески від ПОЗИЦІЙ у списках, тож
 * distance і text rank не треба зводити до однієї шкали.
 */
export function rankCandidates(
  mode: KnowledgeSearchMode,
  vector: readonly KnowledgeChunkMatch[],
  text: readonly KnowledgeTextMatch[],
  maxDistance: number | null,
): KnowledgeChunkCandidate[] {
  const close = maxDistance === null ? vector : vector.filter((m) => m.distance <= maxDistance);
  if (mode === 'vector') return [...close];
  if (mode === 'fts') return [...text];
  const fused = new Map<string, { candidate: KnowledgeChunkCandidate; score: number }>();
  for (const list of [close, text]) {
    list.forEach((candidate, index) => {
      const entry = fused.get(candidate.chunkId) ?? { candidate, score: 0 };
      entry.score += 1 / (RRF_K + index + 1);
      fused.set(candidate.chunkId, entry);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.candidate.chunkId.localeCompare(b.candidate.chunkId))
    .map((entry) => entry.candidate);
}

/**
 * Відбір у порядку ранжування (AI-2a.3 design.md D2): однакові тексти — один раз;
 * фрагмент, що не вміщується в бюджет, пропускається, але менший наступний ще може
 * увійти.
 */
export function selectExcerpts(
  candidates: readonly KnowledgeChunkCandidate[],
  options: Pick<PostgresKnowledgeOptions, 'finalChunks' | 'maxContextTokens'>,
): SelectedExcerpt[] {
  const seen = new Set<string>();
  const selected: SelectedExcerpt[] = [];
  let budget = options.maxContextTokens;
  for (const candidate of candidates) {
    if (selected.length >= options.finalChunks) break;
    if (seen.has(candidate.content)) continue;
    const cost = candidate.tokenCount + EXCERPT_LABEL_TOKENS;
    if (cost > budget) continue;
    seen.add(candidate.content);
    budget -= cost;
    selected.push({
      n: selected.length + 1,
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      sourceKey: candidate.sourceKey,
      revision: candidate.revision,
      title: candidate.title,
      path: candidate.path,
      heading: candidate.heading,
      contentHash: candidate.contentHash,
      content: candidate.content,
      tokenCount: cost,
    });
  }
  return selected;
}

/**
 * Retrieval → вибір знань для промпту. Окремо від `select()`, щоб eval відповідей (AI-5c)
 * отримав РІВНО той вибір, що й воркер, і водночас діагностику з `retrieve()`.
 */
export function selectionFromRetrieval(
  product: string,
  result: KnowledgeRetrieval,
): KnowledgeSelection {
  return {
    version: knowledgeVersion(product, result.excerpts),
    documents: [],
    excerpts: result.excerpts.map(({ tokenCount: _tokenCount, ...excerpt }) => excerpt),
    ...(result.queryEmbedding ? { queryEmbedding: result.queryEmbedding } : {}),
  };
}

/** `postgres:<product>:<sourceKey@revision,…>` відібраних фрагментів (AI-2a.3 design.md D6) */
export function knowledgeVersion(product: string, excerpts: readonly KnowledgeExcerpt[]): string {
  const revisions = [...new Set(excerpts.map((e) => `${e.sourceKey}@${e.revision}`))].sort();
  return `postgres:${product}:${revisions.length > 0 ? revisions.join(',') : 'none'}`;
}
