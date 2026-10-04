import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../ai.config';
import { AiUsageLedger } from '../costs/usage-ledger';
import type { EmbeddingBatch, EmbeddingProvider } from './embedding-provider';
import { createKnowledgeSource } from './knowledge-source.factory';
import { PostgresKnowledgeSource } from './postgres-knowledge-source';
import { RecordingEmbeddingProvider } from './recording-embedding-provider';
import { RuntimeEmbeddingProvider } from './runtime-embedding-provider';

/** In-memory tx: рівно ті виклики, які робить AiUsageLedger.record() */
function ledgerWorld(): {
  rows: Record<string, unknown>[];
  transactions: never;
} {
  const rows: Record<string, unknown>[] = [];
  const tx = {
    aiModelPrice: { findFirst: (): Promise<null> => Promise.resolve(null) },
    aiUsageEvent: {
      createMany: ({ data }: { data: Record<string, unknown>[] }): Promise<{ count: number }> => {
        rows.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
  };
  return {
    rows,
    transactions: {
      withTenantTx: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
    } as never,
  };
}

const batch: EmbeddingBatch = {
  model: 'text-embedding-3-small',
  vectors: [[1]],
  inputTokens: 11,
  billing: {
    provider: 'openrouter',
    model: 'openai/text-embedding-3-small',
    reportedCost: '0.00000022',
    requestId: 'gen-cli-1',
  },
};

describe('RecordingEmbeddingProvider (AI-5b, design.md R9)', () => {
  it('один рядок журналу на кожен успішний виклик, ПІСЛЯ виклику провайдера', async () => {
    const world = ledgerWorld();
    const calls: string[] = [];
    const inner: EmbeddingProvider = {
      embed: (texts) => {
        calls.push(`embed:${String(texts.length)}`);
        expect(world.rows).toHaveLength(calls.length - 1);
        return Promise.resolve(batch);
      },
    };
    const recording = new RecordingEmbeddingProvider(
      inner,
      world.transactions,
      new AiUsageLedger(),
      { kind: 'ingest_embedding', sourceId: 'fms/fms' },
    );

    await recording.embed(['a', 'b'], new AbortController().signal);
    await recording.embed(['c'], new AbortController().signal);

    expect(world.rows).toEqual([
      expect.objectContaining({
        kind: 'ingest_embedding',
        outcome: 'complete',
        sourceId: 'fms/fms',
        userId: null,
        messageId: null,
        provider: 'openrouter',
        model: 'openai/text-embedding-3-small',
        inputTokens: 11,
        reportedCost: '0.00000022',
        providerRequestId: 'gen-cli-1',
        costStatus: 'reported',
      }),
      expect.objectContaining({ kind: 'ingest_embedding' }),
    ]);
  });

  it('невдалий виклик провайдера нічого не пише', async () => {
    const world = ledgerWorld();
    const recording = new RecordingEmbeddingProvider(
      { embed: (): Promise<EmbeddingBatch> => Promise.reject(new Error('embedding-http-503')) },
      world.transactions,
      new AiUsageLedger(),
      { kind: 'eval', sourceId: 'ai:docs:eval' },
    );
    await expect(recording.embed(['a'], new AbortController().signal)).rejects.toThrow('503');
    expect(world.rows).toEqual([]);
  });

  it('воркер НЕ обгортає embeddings: embedding питання пишеться один раз, у claim()', () => {
    const config = loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'postgres', AI_KNOWLEDGE_PRODUCT: 'fms' });
    const source = createKnowledgeSource(
      config,
      {} as never,
      { read: (): Promise<null> => Promise.resolve(null) },
      {},
    );
    expect(source).toBeInstanceOf(PostgresKnowledgeSource);
    const embeddings: unknown = Reflect.get(source, 'embeddings');
    expect(embeddings).toBeInstanceOf(RuntimeEmbeddingProvider);
    expect(embeddings).not.toBeInstanceOf(RecordingEmbeddingProvider);
  });

  it('структурно: код worker-а й tenant api не імпортує RecordingEmbeddingProvider', () => {
    const root = resolve(__dirname, '../../../../..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (
          path.endsWith('.ts') &&
          readFileSync(path, 'utf8').includes('RecordingEmbeddingProvider')
        ) {
          offenders.push(path);
        }
      }
    };
    walk(join(root, 'apps/worker/src'));
    walk(join(root, 'apps/api/src'));
    expect(offenders).toEqual([]);
  });
});
