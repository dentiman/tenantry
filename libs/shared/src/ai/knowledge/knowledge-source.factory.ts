import type { TenantTransactions } from '@saas-skeleton/database';
import type { AiConfig } from '../ai.config';
import type { KnowledgeSource } from './knowledge-source';
import type { PlatformAiSettingsReader } from '../platform/platform-ai-settings.reader';
import { RuntimeEmbeddingProvider } from './runtime-embedding-provider';
import { PostgresKnowledgeSource } from './postgres-knowledge-source';
import { PostgresKnowledgeStore } from './postgres-knowledge-store';
import { StaticKnowledgeSource } from './static-knowledge-source';

/**
 * `postgres` без продукту валить старт воркера (AI-2a.3, design.md D1): тихий відкат на
 * статичний корпус означав би, що інсталяція, налаштована на FMS, відповідає довідкою
 * SaaS Skeleton. Облікові дані embeddings на старті більше не обов'язкові (AI-5a): ключ
 * може прийти з налаштувань суперадміна, а без нього падає конкретне питання.
 */
export function createKnowledgeSource(
  config: AiConfig,
  transactions: TenantTransactions,
  settings: Pick<PlatformAiSettingsReader, 'read'>,
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeSource {
  if (config.knowledge.backend === 'static') {
    return new StaticKnowledgeSource();
  }
  if (config.knowledge.product === null) {
    throw new Error(
      'Invalid AI configuration — AI_KNOWLEDGE_PRODUCT: required when AI_KNOWLEDGE_BACKEND=postgres',
    );
  }
  const embeddings = new RuntimeEmbeddingProvider(config, settings, env);
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
