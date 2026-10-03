import type { TenantTransactions } from '@saas-skeleton/database';
import type { AiConfig } from '../ai.config';
import type { KnowledgeSource } from './knowledge-source';
import { embeddingProviderFromEnv } from './openai-embedding-provider';
import { PostgresKnowledgeSource } from './postgres-knowledge-source';
import { PostgresKnowledgeStore } from './postgres-knowledge-store';
import { StaticKnowledgeSource } from './static-knowledge-source';

/**
 * `postgres` без продукту чи облікових даних embeddings валить старт воркера з іменем
 * змінної (AI-2a.3, design.md D1): тихий відкат на статичний корпус означав би, що
 * інсталяція, налаштована на FMS, відповідає довідкою SaaS Skeleton.
 */
export function createKnowledgeSource(
  config: AiConfig,
  transactions: TenantTransactions,
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeSource {
  if (config.knowledge.backend === 'static') {
    return new StaticKnowledgeSource();
  }
  const embeddings = embeddingProviderFromEnv(env);
  const missing = [
    ...(config.knowledge.product === null ? ['AI_KNOWLEDGE_PRODUCT'] : []),
    ...(embeddings === null
      ? ['AI_EMBEDDING_BASE_URL/AI_EMBEDDING_API_KEY (or AI_BASE_URL/AI_API_KEY)']
      : []),
  ];
  if (config.knowledge.product === null || embeddings === null) {
    throw new Error(
      `Invalid AI configuration — ${missing.map((name) => `${name}: required when AI_KNOWLEDGE_BACKEND=postgres`).join('; ')}`,
    );
  }
  return new PostgresKnowledgeSource(new PostgresKnowledgeStore(transactions), embeddings, {
    product: config.knowledge.product,
    mode: config.knowledge.mode,
    vectorCandidates: config.knowledge.vectorCandidates,
    textCandidates: config.knowledge.textCandidates,
    finalChunks: config.knowledge.finalChunks,
    maxContextTokens: config.knowledge.maxContextTokens,
    maxDistance: config.knowledge.maxDistance,
  });
}
