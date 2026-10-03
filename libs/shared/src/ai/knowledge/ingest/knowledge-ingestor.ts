import {
  KNOWLEDGE_EMBEDDING_MODEL,
  serializeKnowledgeVector,
  type EmbeddingProvider,
} from '../embedding-provider';
import { PostgresIngestStore } from './postgres-ingest-store';
import type { SourcePreview } from './preview';

export interface IngestResult {
  revision: string;
  unchanged: boolean;
  documents: number;
  chunks: number;
  embeddedTexts: number;
  reusedChunks: number;
  inputTokens: number;
}
export interface IngestOptions {
  batchSize?: number;
  concurrency?: number;
}

/** Provider work is outside DB transactions; only completed batches are checkpointed. */
export class KnowledgeIngestor {
  constructor(
    private readonly store: PostgresIngestStore,
    private readonly provider: EmbeddingProvider,
  ) {}

  async ingest(
    input: SourcePreview,
    signal: AbortSignal,
    options: IngestOptions = {},
  ): Promise<IngestResult> {
    const preview = structuredClone(input);
    const batchSize = options.batchSize ?? 32;
    const concurrency = options.concurrency ?? 2;
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > 128 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 4
    )
      throw new Error('Invalid ingest batch/concurrency');
    if (
      !preview.documents.length ||
      preview.totals.documents !== preview.documents.length ||
      preview.totals.chunks !==
        preview.documents.reduce((sum, doc) => sum + doc.chunks.length, 0) ||
      preview.documents.some((doc) => !doc.chunks.length) ||
      preview.totals.chunks > 50_000 ||
      preview.embeddingModel !== KNOWLEDGE_EMBEDDING_MODEL
    )
      throw new Error('Invalid or empty ingest snapshot');
    signal.throwIfAborted();
    const run = await this.store.begin(preview);
    const result: IngestResult = {
      revision: preview.revision,
      unchanged: run.unchanged,
      documents: preview.totals.documents,
      chunks: preview.totals.chunks,
      embeddedTexts: 0,
      reusedChunks: 0,
      inputTokens: 0,
    };
    if (run.unchanged) return { ...result, reusedChunks: result.chunks };
    const controller = new AbortController();
    const workSignal = AbortSignal.any([signal, controller.signal]);
    try {
      const cache = await this.store.cached(run);
      const rows = await this.store.stage(run, preview);
      const cached = rows.filter((row) => cache.has(row.chunk.contentHash));
      result.reusedChunks = cached.length;
      for (let i = 0; i < cached.length; i += batchSize) {
        workSignal.throwIfAborted();
        await this.store.write(run, cached.slice(i, i + batchSize), cache);
      }
      const missing = [
        ...new Map(
          rows
            .filter((row) => !cache.has(row.chunk.contentHash))
            .map((row) => [row.chunk.contentHash, row.chunk]),
        ).values(),
      ];
      const batches = Array.from({ length: Math.ceil(missing.length / batchSize) }, (_, i) =>
        missing.slice(i * batchSize, (i + 1) * batchSize),
      );
      let cursor = 0;
      // The first failure aborts siblings; report it, not their resulting AbortErrors.
      let firstError: Error | undefined;
      const worker = async (): Promise<void> => {
        try {
          for (;;) {
            workSignal.throwIfAborted();
            const batch = batches[cursor++];
            if (!batch) return;
            const response = await this.provider.embed(
              batch.map((chunk) => chunk.embeddingText),
              workSignal,
            );
            workSignal.throwIfAborted();
            if (
              response.vectors.length !== batch.length ||
              !Number.isInteger(response.inputTokens) ||
              response.inputTokens < 0
            )
              throw new Error('Invalid embedding batch');
            const vectors = new Map(
              batch.map((chunk, i) => [
                chunk.contentHash,
                serializeKnowledgeVector(response.model, response.vectors[i] ?? []),
              ]),
            );
            const batchRows = rows.filter((row) => vectors.has(row.chunk.contentHash));
            // Bound DB transactions independently of deduplication fan-out.
            for (let i = 0; i < batchRows.length; i += batchSize) {
              workSignal.throwIfAborted();
              await this.store.write(run, batchRows.slice(i, i + batchSize), vectors);
            }
            result.embeddedTexts += batch.length;
            result.inputTokens += response.inputTokens;
          }
        } catch (error) {
          firstError ??= error instanceof Error ? error : new Error(String(error));
          controller.abort();
          throw error;
        }
      };
      await Promise.allSettled(Array.from({ length: concurrency }, worker));
      if (firstError !== undefined) throw firstError;
      workSignal.throwIfAborted();
      await this.store.publish(run, preview);
      return result;
    } catch (error) {
      await this.store.fail(run);
      throw error;
    }
  }
}
