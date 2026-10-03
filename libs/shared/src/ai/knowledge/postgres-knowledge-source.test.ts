import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../ai.config';
import { createKnowledgeSource } from './knowledge-source.factory';
import {
  citationsFor,
  citedNumbers,
  parseKnowledgeChunkRefs,
  toKnowledgeChunkRefs,
} from './citations';
import type { EmbeddingProvider } from './embedding-provider';
import {
  EXCERPT_LABEL_TOKENS,
  PostgresKnowledgeSource,
  knowledgeVersion,
  selectExcerpts,
} from './postgres-knowledge-source';
import type { KnowledgeChunkMatch, KnowledgeVectorQuery } from './postgres-knowledge-store';
import { StaticKnowledgeSource } from './static-knowledge-source';

const vector = [1, ...Array<number>(1535).fill(0)];

function match(id: string, overrides: Partial<KnowledgeChunkMatch> = {}): KnowledgeChunkMatch {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    sourceKey: 'fms',
    revision: 'r1',
    canonicalId: id,
    path: `${id}.md`,
    title: `Title ${id}`,
    language: 'en',
    heading: `Heading ${id}`,
    content: `content ${id}`,
    contentHash: id.padEnd(64, '0'),
    tokenCount: 100,
    distance: 0.1,
    ...overrides,
  };
}

describe('selectExcerpts', () => {
  it('keeps distance order, numbers from 1 and stops at the chunk limit', () => {
    const picked = selectExcerpts(
      ['a', 'b', 'c'].map((id) => match(id)),
      {
        finalChunks: 2,
        maxContextTokens: 10_000,
      },
    );
    expect(picked.map((e) => [e.n, e.chunkId])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('skips duplicates and anything over budget, but still takes a smaller later chunk', () => {
    const cost = 100 + EXCERPT_LABEL_TOKENS;
    const picked = selectExcerpts(
      [
        match('a'),
        match('dup', { content: 'content a' }),
        match('big', { tokenCount: 400 }),
        match('small'),
      ],
      { finalChunks: 5, maxContextTokens: cost * 2 },
    );
    expect(picked.map((e) => e.chunkId)).toEqual(['a', 'small']);
    expect(picked.reduce((sum, e) => sum + e.tokenCount, 0)).toBeLessThanOrEqual(cost * 2);
  });

  it('returns nothing for nothing', () => {
    expect(selectExcerpts([], { finalChunks: 5, maxContextTokens: 2500 })).toEqual([]);
  });
});

describe('knowledgeVersion', () => {
  it('lists distinct sorted source revisions, or none', () => {
    const excerpts = selectExcerpts(
      [match('a', { sourceKey: 'z', revision: '2' }), match('b'), match('c')],
      { finalChunks: 5, maxContextTokens: 10_000 },
    );
    expect(knowledgeVersion('fms', excerpts)).toBe('postgres:fms:fms@r1,z@2');
    expect(knowledgeVersion('fms', [])).toBe('postgres:fms:none');
  });
});

describe('PostgresKnowledgeSource', () => {
  it('embeds the question, searches the configured product for the role, drops token counts', async () => {
    const searches: KnowledgeVectorQuery[] = [];
    const embedded: string[][] = [];
    const embeddings: EmbeddingProvider = {
      embed: (texts) => {
        embedded.push([...texts]);
        return Promise.resolve({
          model: 'text-embedding-3-small',
          vectors: [vector],
          inputTokens: 5,
        });
      },
    };
    const source = new PostgresKnowledgeSource(
      {
        search: (query): Promise<KnowledgeChunkMatch[]> => {
          searches.push(query);
          return Promise.resolve([match('a'), match('b')]);
        },
      },
      embeddings,
      { product: 'fms', vectorCandidates: 12, finalChunks: 1, maxContextTokens: 2500 },
    );
    const selection = await source.select({ role: 'USER', question: 'How is billing done?' });
    expect(embedded).toEqual([['How is billing done?']]);
    expect(searches[0]).toMatchObject({ product: 'fms', role: 'USER', limit: 12 });
    expect(selection.documents).toEqual([]);
    expect(selection.version).toBe('postgres:fms:fms@r1');
    expect(selection.excerpts).toHaveLength(1);
    expect(selection.excerpts?.[0]).not.toHaveProperty('tokenCount');
  });

  it('propagates an embedding failure instead of answering without sources', async () => {
    const source = new PostgresKnowledgeSource(
      { search: (): Promise<KnowledgeChunkMatch[]> => Promise.resolve([]) },
      { embed: (): Promise<never> => Promise.reject(new Error('down')) },
      { product: 'fms', vectorCandidates: 12, finalChunks: 5, maxContextTokens: 2500 },
    );
    await expect(source.select({ role: 'ADMIN', question: 'q' })).rejects.toThrow('down');
  });
});

describe('citations', () => {
  const refs = toKnowledgeChunkRefs(
    selectExcerpts([match('a'), match('b'), match('c')], {
      finalChunks: 5,
      maxContextTokens: 10_000,
    }),
  );

  it('reads [n], [n, m] and [n][m] markers', () => {
    expect([...citedNumbers('See [1] and [2, 3][5]; not [x] or [1000].')]).toEqual([1, 2, 3, 5]);
  });

  it('keeps only supplied excerpts the answer actually cites', () => {
    expect(citationsFor('Per [3] and invented [9].', refs).map((r) => r.chunkId)).toEqual(['c']);
    expect(citationsFor('No markers at all.', refs)).toEqual([]);
  });

  it('treats missing or corrupt stored metadata as no citations', () => {
    expect(citationsFor('[1]', null)).toEqual([]);
    expect(parseKnowledgeChunkRefs([{ n: 'one' }])).toEqual([]);
    expect(refs[0]).not.toHaveProperty('content');
  });
});

describe('createKnowledgeSource', () => {
  const transactions = {} as never;

  it('defaults to the static corpus', () => {
    expect(createKnowledgeSource(loadAiConfig({}), transactions, {})).toBeInstanceOf(
      StaticKnowledgeSource,
    );
  });

  it('postgres mode names every missing setting instead of falling back', () => {
    const config = loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'postgres' });
    expect(() => createKnowledgeSource(config, transactions, {})).toThrow(
      /AI_KNOWLEDGE_PRODUCT.*AI_EMBEDDING_BASE_URL/,
    );
  });

  it('postgres mode builds the retrieval source with generation credentials as fallback', () => {
    const config = loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'postgres', AI_KNOWLEDGE_PRODUCT: 'fms' });
    const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_API_KEY: 'sk-test' };
    expect(createKnowledgeSource(config, transactions, env)).toBeInstanceOf(
      PostgresKnowledgeSource,
    );
  });

  it('rejects an unknown backend and clamps final chunks to candidates', () => {
    expect(() => loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'elastic' })).toThrow(/AI_KNOWLEDGE_BACKEND/);
    const config = loadAiConfig({ AI_DOCS_VECTOR_CANDIDATES: '3', AI_DOCS_FINAL_CHUNKS: '5' });
    expect(config.knowledge).toMatchObject({
      backend: 'static',
      vectorCandidates: 3,
      finalChunks: 3,
    });
  });
});
