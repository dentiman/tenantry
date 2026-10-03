/** The first index profile. A different model/dimension needs a new index revision. */
export const KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-small';
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingBatch {
  readonly model: string;
  /** Same order as the requested texts. */
  readonly vectors: readonly (readonly number[])[];
  readonly inputTokens: number;
}

/** Separate from generation; the ingestion step will supply an actual adapter. */
export interface EmbeddingProvider {
  embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Shared boundary for writes and search; PostgreSQL repeats dimension/model checks. */
export function serializeKnowledgeVector(model: string, vector: readonly number[]): string {
  if (model !== KNOWLEDGE_EMBEDDING_MODEL) {
    throw new Error(`Knowledge index requires embedding model ${KNOWLEDGE_EMBEDDING_MODEL}`);
  }
  if (
    vector.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38) ||
    !vector.some((value) => Math.fround(value) !== 0)
  ) {
    throw new Error(
      'Knowledge embedding must be a nonzero, finite 1536-dimensional float32 vector',
    );
  }
  return JSON.stringify(vector);
}
