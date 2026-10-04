import { z } from 'zod';

/**
 * Фрагмент, відібраний retrieval-ом для ОДНІЄЇ відповіді (AI-2a.3, design.md D6).
 * `n` — номер, під яким фрагмент іде в промпт і на який модель посилається `[n]`.
 */
export interface KnowledgeExcerpt {
  readonly n: number;
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourceKey: string;
  readonly revision: string;
  readonly title: string;
  readonly path: string;
  readonly heading: string;
  /** SHA-256 тексту: знаходить той самий фрагмент і після переіндексування (design.md D8) */
  readonly contentHash: string;
  readonly content: string;
}

/**
 * Те, що з фрагмента зберігається в `ai_messages.knowledge_chunks`: лише метадані.
 * Текст лишається в індексі й зникає разом із ним — видалене джерело не «оживає»
 * з історії розмови.
 */
export const KnowledgeChunkRefSchema = z.object({
  n: z.number().int().positive(),
  chunkId: z.string().min(1),
  documentId: z.string().min(1),
  sourceKey: z.string().min(1),
  revision: z.string().min(1),
  title: z.string(),
  path: z.string(),
  heading: z.string(),
  contentHash: z.string().length(64),
});
export type KnowledgeChunkRef = z.infer<typeof KnowledgeChunkRefSchema>;

export function toKnowledgeChunkRefs(excerpts: readonly KnowledgeExcerpt[]): KnowledgeChunkRef[] {
  return excerpts.map(({ content: _content, ...ref }) => ref);
}

/** Зіпсований чи застарілий JSON не валить читання стрічки — просто без цитат */
export function parseKnowledgeChunkRefs(value: unknown): KnowledgeChunkRef[] {
  const parsed = z.array(KnowledgeChunkRefSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** `[1]`, `[2, 3]`, `[2,3]` — номери посилань у тексті відповіді */
export const CITATION_MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

export function citedNumbers(content: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of content.matchAll(CITATION_MARKER)) {
    for (const part of (match[1] ?? '').split(',')) {
      numbers.add(Number(part.trim()));
    }
  }
  return numbers;
}

/**
 * Перевірені цитати відповіді (design.md D7): лише ті збережені фрагменти, на чий
 * номер текст справді посилається. Номер, вигаданий моделлю, ні з чим не збігається
 * й не показується.
 */
export function citationsFor(content: string, storedChunks: unknown): KnowledgeChunkRef[] {
  const refs = parseKnowledgeChunkRefs(storedChunks);
  if (refs.length === 0) {
    return [];
  }
  const cited = citedNumbers(content);
  return refs.filter((ref) => cited.has(ref.n));
}
