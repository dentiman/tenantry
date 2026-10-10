import { describe, expect, it } from 'vitest';
import bundledCorpus from '../generated/knowledge-corpus.json';
import { parseKnowledgeCorpus, type KnowledgeCorpus } from '../corpus-builder';
import { KNOWLEDGE_EMBEDDING_MODEL } from '../embedding-provider';
import { CORPUS_CHUNKING, CORPUS_PRODUCT, previewCorpus } from './corpus-preview';

const corpus = parseKnowledgeCorpus(bundledCorpus);

/** Копія корпусу зі зміненим тілом одного документа (версію не перераховуємо: previewCorpus її не читає) */
function withEditedBody(slug: string): KnowledgeCorpus {
  return {
    ...corpus,
    documents: corpus.documents.map((doc) =>
      doc.slug === slug ? { ...doc, body: `${doc.body}\n\n## Extra\n\nAn added paragraph.` } : doc,
    ),
  };
}

describe('previewCorpus: власна документація як джерело індексу', () => {
  const preview = previewCorpus(corpus);

  it('перетворює кожен документ корпусу на чанки під продуктом saas', () => {
    expect(preview.product).toBe(CORPUS_PRODUCT);
    expect(preview.sourceKey).toBe('saas');
    expect(preview.embeddingModel).toBe(KNOWLEDGE_EMBEDDING_MODEL);
    expect(preview.documents).toHaveLength(corpus.documents.length);
    expect(preview.rejected).toEqual([]);
    for (const doc of preview.documents) {
      expect(doc.chunks.length).toBeGreaterThan(0);
      // Ліміт токенів чанка включає breadcrumb — той самий інваріант, що в пілоті FMS
      for (const chunk of doc.chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(CORPUS_CHUNKING.targetTokens);
        expect(chunk.embeddingText).toContain(doc.title);
      }
    }
  });

  it('підсумки збігаються з чанками, як вимагає KnowledgeIngestor', () => {
    const chunks = preview.documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
    expect(preview.totals.documents).toBe(preview.documents.length);
    expect(preview.totals.chunks).toBe(chunks);
    expect(preview.totals.embeddingTokens).toBe(
      preview.documents.reduce(
        (sum, doc) => sum + doc.chunks.reduce((n, chunk) => n + chunk.tokenCount, 0),
        0,
      ),
    );
  });

  it('зберігає правило аудиторій статичного бекенду: admin — лише ADMIN, all — усім', () => {
    for (const source of corpus.documents) {
      const doc = preview.documents.find((candidate) => candidate.canonicalId === source.slug);
      expect(doc?.audience).toEqual(source.audience === 'admin' ? ['ADMIN'] : ['ADMIN', 'USER']);
    }
    // Охоронець: хоча б один документ справді лише для адміна, інакше перевірка вище нічого не доводить
    expect(preview.documents.some((doc) => doc.audience.length === 1)).toBe(true);
  });

  it('детермінований: той самий корпус дає ту саму ревізію (повторна індексація — unchanged)', () => {
    expect(previewCorpus(corpus).revision).toBe(preview.revision);
    expect(previewCorpus(corpus).manifestHash).toBe(preview.manifestHash);
  });

  it('зміна одного документа дає нову ревізію, але чанки решти лишаються тими самими (embeddings перевикористовуються)', () => {
    const edited = previewCorpus(withEditedBody('customers'));
    expect(edited.revision).not.toBe(preview.revision);

    const hashesOf = (p: typeof preview, slug: string): string[] =>
      p.documents.find((doc) => doc.canonicalId === slug)?.chunks.map((c) => c.contentHash) ?? [];
    for (const doc of corpus.documents) {
      if (doc.slug === 'customers') continue;
      expect(hashesOf(edited, doc.slug)).toEqual(hashesOf(preview, doc.slug));
    }
    // Змінений документ має хоч один новий чанк, тож до провайдера піде лише він
    const before = new Set(hashesOf(preview, 'customers'));
    expect(hashesOf(edited, 'customers').some((hash) => !before.has(hash))).toBe(true);
  });

  it('вартість індексації в межах бюджету корпусу (запобіжник від випадкового роздування)', () => {
    // 100 000 символів корпусу ≈ 25 000 токенів; з breadcrumb-ами й overlap — не більше за 40 000
    expect(preview.totals.embeddingTokens).toBeGreaterThan(1_000);
    expect(preview.totals.embeddingTokens).toBeLessThan(40_000);
  });
});
