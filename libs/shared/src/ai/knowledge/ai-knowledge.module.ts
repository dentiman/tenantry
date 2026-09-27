import { Logger, Module, type Provider } from '@nestjs/common';
import { KNOWLEDGE_SOURCE, type KnowledgeSource } from './knowledge-source';
import { StaticKnowledgeSource } from './static-knowledge-source';

const knowledgeSourceFactory: Provider = {
  provide: KNOWLEDGE_SOURCE,
  useFactory: async (): Promise<KnowledgeSource> => {
    const source = new StaticKnowledgeSource();
    const { version, documents } = await source.select({ role: 'ADMIN', question: '' });
    new Logger('AiKnowledgeModule').log(
      `AI knowledge version ${version}, ${String(documents.length)} documents`,
    );
    return source;
  },
};

/**
 * Джерело знань — ЛИШЕ для воркера (ai-1b design.md D6), як і `AiLlmModule`: api
 * промпт не збирає, тож і корпус йому ні до чого.
 */
@Module({
  providers: [knowledgeSourceFactory],
  exports: [KNOWLEDGE_SOURCE],
})
export class AiKnowledgeModule {}
