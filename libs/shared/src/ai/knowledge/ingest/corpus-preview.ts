import type { KnowledgeAudience, KnowledgeCorpus } from '../corpus-builder';
import { KNOWLEDGE_EMBEDDING_DIMENSIONS, KNOWLEDGE_EMBEDDING_MODEL } from '../embedding-provider';
import { chunkMarkdown, hashText, PARSER_VERSION } from './chunker';
import { canonical, type PreviewDocument, type SourcePreview } from './preview';

/**
 * Власна документація продукту (`docs/ai-knowledge/`) як ДЖЕРЕЛО ІНДЕКСУ — той самий
 * `SourcePreview`, що дає `previewSource` для FMS, тож індексація (`KnowledgeIngestor`), пошук і
 * цитати лишаються без змін. Не другий парсер Markdown і не другий формат front-matter: вхід —
 * уже зібраний і перевірений в CI корпус (`pnpm ai:knowledge`, `ai:knowledge:check`), тобто
 * індекс гарантовано збігається з тим, що рев'юїли в PR і що лежить у статичному корпусі.
 *
 * `product` = `saas`: саме його вказує `AI_KNOWLEDGE_PRODUCT` воркера, коли `AI_KNOWLEDGE_BACKEND=postgres`.
 */
export const CORPUS_SOURCE_KEY = 'saas';
export const CORPUS_PRODUCT = 'saas';

/** Ті самі межі чанка, що в пілоті FMS: 400 токенів, 50 overlap (docs/ai-sources/README.md) */
export const CORPUS_CHUNKING = { targetTokens: 400, overlapTokens: 50 } as const;

/**
 * `audience` корпусу → ролі, яким документ показується. Те саме правило, що фільтр
 * `StaticKnowledgeSource` (`admin` — лише ADMIN, `all` — усім): перехід зі статичного бекенду на
 * індекс не міняє, хто що бачить.
 */
export const CORPUS_AUDIENCE_ROLES: Readonly<Record<KnowledgeAudience, readonly ('ADMIN' | 'USER')[]>> =
  { all: ['ADMIN', 'USER'], admin: ['ADMIN'] };

/**
 * Корпус → снапшот для індексації. Чиста функція без БД і мережі (як `previewSource`): та сама
 * версія корпусу дає той самий `revision`, тому повторний запуск — `unchanged: true`, нуль викликів
 * провайдера, а зміна одного документа перевикористовує векторів решти за `content_hash`.
 *
 * `revision` залежить від налаштувань джерела (межі чанка, мапінг аудиторій), версії парсера,
 * профілю embeddings і хешів документів — як у `previewSource`. Зміна будь-чого з цього дає нову
 * ревізію.
 */
export function previewCorpus(corpus: KnowledgeCorpus): SourcePreview {
  const documents: PreviewDocument[] = corpus.documents.map((doc) => {
    const chunks = chunkMarkdown(
      doc.body,
      doc.title,
      CORPUS_CHUNKING.targetTokens,
      CORPUS_CHUNKING.overlapTokens,
    );
    if (chunks.length === 0) {
      throw new Error(`Knowledge document "${doc.slug}" produced no chunks`);
    }
    return {
      // Шлях — лише мітка для цитат і ідентичності; файлів на диску індексатор не читає
      path: `${doc.slug}.md`,
      canonicalId: doc.slug,
      title: doc.title,
      language: 'en',
      audience: [...CORPUS_AUDIENCE_ROLES[doc.audience]].sort(),
      // Хеш того, що бачить модель і що вирішує доступ: назва, аудиторія, тіло
      fileHash: hashText(canonical({ title: doc.title, audience: doc.audience, body: doc.body })),
      contentHash: hashText(chunks.map((chunk) => chunk.contentHash).join('\n')),
      chunks,
    };
  });

  const manifestHash = hashText(
    canonical({
      sourceKey: CORPUS_SOURCE_KEY,
      product: CORPUS_PRODUCT,
      chunking: CORPUS_CHUNKING,
      audienceRoles: CORPUS_AUDIENCE_ROLES,
    }),
  );
  const revision = hashText(
    canonical({
      manifestHash,
      parser: PARSER_VERSION,
      model: KNOWLEDGE_EMBEDDING_MODEL,
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      files: documents.map((doc) => [doc.path, doc.fileHash]),
    }),
  );

  return {
    sourceKey: CORPUS_SOURCE_KEY,
    product: CORPUS_PRODUCT,
    revision,
    manifestHash,
    parserVersion: PARSER_VERSION,
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    tokenizer: 'cl100k_base',
    documents,
    rejected: [],
    totals: {
      documents: documents.length,
      rejected: 0,
      chunks: documents.reduce((sum, doc) => sum + doc.chunks.length, 0),
      embeddingTokens: documents.reduce(
        (sum, doc) => sum + doc.chunks.reduce((n, chunk) => n + chunk.tokenCount, 0),
        0,
      ),
    },
  };
}
