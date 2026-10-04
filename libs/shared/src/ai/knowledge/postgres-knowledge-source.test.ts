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
  RRF_K,
  knowledgeVersion,
  rankCandidates,
  selectExcerpts,
  type PostgresKnowledgeOptions,
} from './postgres-knowledge-source';
import type {
  KnowledgeChunkMatch,
  KnowledgeTextMatch,
  KnowledgeTextQuery,
  KnowledgeVectorQuery,
} from './postgres-knowledge-store';
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

const OPTIONS: PostgresKnowledgeOptions = {
  product: 'fms',
  mode: 'vector',
  vectorCandidates: 12,
  textCandidates: 12,
  finalChunks: 5,
  maxContextTokens: 2500,
  maxDistance: null,
};

const textMatch = (id: string, textRank = 0.5): KnowledgeTextMatch => {
  const { distance: _distance, ...candidate } = match(id);
  return { ...candidate, textRank };
};

/** Сховище й провайдер, що записують виклики */
function harness(
  options: Partial<PostgresKnowledgeOptions>,
  lists: { vector?: KnowledgeChunkMatch[]; text?: KnowledgeTextMatch[] } = {},
  embed: EmbeddingProvider['embed'] = () =>
    Promise.resolve({ model: 'text-embedding-3-small', vectors: [vector], inputTokens: 5 }),
): {
  source: PostgresKnowledgeSource;
  calls: { embedded: string[][]; vector: KnowledgeVectorQuery[]; text: KnowledgeTextQuery[] };
} {
  const calls = {
    embedded: [] as string[][],
    vector: [] as KnowledgeVectorQuery[],
    text: [] as KnowledgeTextQuery[],
  };
  const source = new PostgresKnowledgeSource(
    {
      search: (query): Promise<KnowledgeChunkMatch[]> => {
        calls.vector.push(query);
        return Promise.resolve(lists.vector ?? []);
      },
      searchText: (query): Promise<KnowledgeTextMatch[]> => {
        calls.text.push(query);
        return Promise.resolve(lists.text ?? []);
      },
    },
    {
      embed: (texts, signal): ReturnType<EmbeddingProvider['embed']> => {
        calls.embedded.push([...texts]);
        return embed(texts, signal);
      },
    },
    { ...OPTIONS, ...options },
  );
  return { source, calls };
}

describe('PostgresKnowledgeSource', () => {
  it('vector: embeds the question, searches the product for the role, drops token counts', async () => {
    const { source, calls } = harness({ finalChunks: 1 }, { vector: [match('a'), match('b')] });
    const selection = await source.select({ role: 'USER', question: 'How is billing done?' });
    expect(calls.embedded).toEqual([['How is billing done?']]);
    expect(calls.vector[0]).toMatchObject({ product: 'fms', role: 'USER', limit: 12 });
    expect(calls.text).toEqual([]);
    expect(selection.documents).toEqual([]);
    expect(selection.version).toBe('postgres:fms:fms@r1');
    expect(selection.excerpts).toHaveLength(1);
    expect(selection.excerpts?.[0]).not.toHaveProperty('tokenCount');
  });

  it('vector: an embedding failure propagates instead of answering without sources', async () => {
    const { source } = harness({}, {}, () => Promise.reject(new Error('down')));
    await expect(source.select({ role: 'ADMIN', question: 'q' })).rejects.toThrow('down');
  });

  it('fts: never calls the embedding API', async () => {
    const { source, calls } = harness({ mode: 'fts' }, { text: [textMatch('t')] });
    const result = await source.retrieve({ role: 'ADMIN', question: 'billing' });
    expect(calls.embedded).toEqual([]);
    expect(calls.text[0]).toMatchObject({
      product: 'fms',
      role: 'ADMIN',
      text: 'billing',
      limit: 12,
    });
    expect(result.excerpts.map((e) => e.chunkId)).toEqual(['t']);
  });

  it('hybrid: degrades to full-text search when embeddings fail', async () => {
    const { source } = harness({ mode: 'hybrid' }, { text: [textMatch('t')] }, () =>
      Promise.reject(new Error('down')),
    );
    const result = await source.retrieve({ role: 'ADMIN', question: 'billing' });
    expect(result.degraded).toBe(true);
    expect(result.excerpts.map((e) => e.chunkId)).toEqual(['t']);
  });

  it('hybrid: fuses both lists by rank', async () => {
    const { source } = harness(
      { mode: 'hybrid' },
      { vector: [match('a'), match('b')], text: [textMatch('b'), textMatch('c')] },
    );
    const result = await source.retrieve({ role: 'ADMIN', question: 'q' });
    expect(result.degraded).toBe(false);
    expect(result.excerpts.map((e) => e.chunkId)).toEqual(['b', 'a', 'c']);
  });
});

describe('rankCandidates', () => {
  const vectorList = [match('a', { distance: 0.3 }), match('b', { distance: 0.6 })];

  it('vector threshold drops distant candidates; null keeps everything', () => {
    expect(rankCandidates('vector', vectorList, [], 0.5).map((c) => c.chunkId)).toEqual(['a']);
    expect(rankCandidates('vector', vectorList, [], null).map((c) => c.chunkId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('a chunk found by both branches outranks one found by a single branch', () => {
    const text = [textMatch('c'), textMatch('b')];
    expect(rankCandidates('hybrid', vectorList, text, null).map((c) => c.chunkId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('the threshold applies before fusion; text hits survive it', () => {
    expect(
      rankCandidates('hybrid', vectorList, [textMatch('c')], 0.5).map((c) => c.chunkId),
    ).toEqual(['a', 'c']);
    expect(rankCandidates('hybrid', vectorList, [], 0.1)).toEqual([]);
  });

  it('equal fused scores are ordered deterministically by chunk id', () => {
    const fused = rankCandidates('hybrid', [match('z')], [textMatch('y')], null);
    expect(fused.map((c) => c.chunkId)).toEqual(['y', 'z']);
    expect(1 / (RRF_K + 1)).toBeCloseTo(0.0164, 4);
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
  const noSettings = { read: (): Promise<null> => Promise.resolve(null) };

  it('defaults to the static corpus', () => {
    expect(createKnowledgeSource(loadAiConfig({}), transactions, noSettings, {})).toBeInstanceOf(
      StaticKnowledgeSource,
    );
  });

  it('postgres mode without a product fails boot instead of falling back', () => {
    const config = loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'postgres' });
    expect(() => createKnowledgeSource(config, transactions, noSettings, {})).toThrow(
      /AI_KNOWLEDGE_PRODUCT/,
    );
  });

  it('postgres mode no longer needs embedding credentials at boot (AI-5a: they may come from the UI)', () => {
    const config = loadAiConfig({ AI_KNOWLEDGE_BACKEND: 'postgres', AI_KNOWLEDGE_PRODUCT: 'fms' });
    expect(createKnowledgeSource(config, transactions, noSettings, {})).toBeInstanceOf(
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

  it('search mode and threshold: eval-chosen defaults, explicit none, validation', () => {
    expect(loadAiConfig({}).knowledge).toMatchObject({
      mode: 'hybrid',
      textCandidates: 12,
      maxDistance: 0.8,
    });
    expect(loadAiConfig({ AI_DOCS_MAX_DISTANCE: 'none' }).knowledge.maxDistance).toBeNull();
    expect(
      loadAiConfig({ AI_DOCS_SEARCH_MODE: 'fts', AI_DOCS_MAX_DISTANCE: '0.6' }).knowledge,
    ).toMatchObject({ mode: 'fts', maxDistance: 0.6 });
    expect(() => loadAiConfig({ AI_DOCS_SEARCH_MODE: 'bm25' })).toThrow(/AI_DOCS_SEARCH_MODE/);
    expect(() => loadAiConfig({ AI_DOCS_MAX_DISTANCE: '3' })).toThrow(/AI_DOCS_MAX_DISTANCE/);
  });
});
