import { Logger, Module, type Provider } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import { AI_CONFIG, type AiConfig } from '../ai.config';
import { createKnowledgeSource } from './knowledge-source.factory';
import { KNOWLEDGE_SOURCE, type KnowledgeSource } from './knowledge-source';
import { StaticKnowledgeSource } from './static-knowledge-source';

const knowledgeSourceFactory: Provider = {
  provide: KNOWLEDGE_SOURCE,
  inject: [AI_CONFIG, TenantTransactions],
  useFactory: async (
    config: AiConfig,
    transactions: TenantTransactions,
  ): Promise<KnowledgeSource> => {
    const logger = new Logger('AiKnowledgeModule');
    const source = createKnowledgeSource(config, transactions);
    if (source instanceof StaticKnowledgeSource) {
      const { version, documents } = await source.select({ role: 'ADMIN', question: '' });
      logger.log(`AI knowledge: static, version ${version}, ${String(documents.length)} documents`);
    } else {
      const { product, finalChunks, maxContextTokens } = config.knowledge;
      logger.log(
        `AI knowledge: postgres, product ${String(product)}, ≤${String(finalChunks)} excerpts / ${String(maxContextTokens)} tokens`,
      );
    }
    return source;
  },
};

/**
 * Джерело знань — ЛИШЕ для воркера (ai-1b design.md D6), як і `AiLlmModule`: api
 * промпт не збирає, тож і корпус, і ключ embeddings йому ні до чого.
 */
@Module({
  providers: [knowledgeSourceFactory],
  exports: [KNOWLEDGE_SOURCE],
})
export class AiKnowledgeModule {}
