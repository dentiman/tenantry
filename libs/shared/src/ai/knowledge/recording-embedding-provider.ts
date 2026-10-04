import type { TenantTransactions } from '@saas-skeleton/database';
import {
  ledgerTokensForEmbedding,
  type AiUsageLedger,
  type UsageKind,
} from '../costs/usage-ledger';
import type { EmbeddingBatch, EmbeddingProvider } from './embedding-provider';

/**
 * Облік embedding-викликів операторських CLI (AI-5b, design.md R9): ingest
 * (`ingest_embedding`), eval і search (`eval`). Після КОЖНОГО успішного HTTP-батча — один
 * рядок журналу у власній короткій tenant-транзакції (`saas_app`, tenant із
 * `withKnowledgeTenant`), тобто вже після виклику провайдера, а не всередині транзакції з ним.
 *
 * Не для воркера: там embedding питання пишеться в транзакції `claim()` разом із id
 * відповіді, і обгортка дала б подвійний облік (перевіряє тест фабрики джерела знань).
 */
export class RecordingEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly transactions: TenantTransactions,
    private readonly ledger: AiUsageLedger,
    private readonly meta: {
      readonly kind: Extract<UsageKind, 'ingest_embedding' | 'eval'>;
      /** Ingest — `product/sourceKey` джерела; eval/search — назва команди */
      readonly sourceId: string;
    },
  ) {}

  async embed(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingBatch> {
    const batch = await this.inner.embed(texts, signal);
    await this.transactions.withTenantTx((tx) =>
      this.ledger.record(tx, [
        {
          kind: this.meta.kind,
          outcome: 'complete',
          sourceId: this.meta.sourceId,
          provider: batch.billing?.provider ?? 'unknown',
          model: batch.billing?.model ?? batch.model,
          tokens: ledgerTokensForEmbedding(batch.inputTokens),
          reportedCost: batch.billing?.reportedCost ?? null,
          requestId: batch.billing?.requestId ?? null,
        },
      ]),
    );
    return batch;
  }
}
