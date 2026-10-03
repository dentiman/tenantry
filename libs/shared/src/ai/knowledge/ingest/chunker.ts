import { createHash } from 'node:crypto';
import { getEncoding } from 'js-tiktoken';
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';

// Bundled ranks: initializing the tokenizer never downloads anything.
const tokenizer = getEncoding('cl100k_base');
export const PARSER_VERSION = 'markdown-sections-cl100k-v1';
export const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');
export const countTokens = (text: string): number => tokenizer.encode(text, [], []).length;

export interface PreviewChunk {
  ordinal: number;
  heading: string;
  content: string;
  embeddingText: string;
  contentHash: string;
  tokenCount: number;
}

/** Drop HTML, image URLs and executable code blocks, retain plain text diagrams. */
function plainText(node: Nodes): string {
  if (
    node.type === 'html' ||
    node.type === 'definition' ||
    node.type === 'image' ||
    node.type === 'imageReference'
  )
    return '';
  if (node.type === 'code')
    return ['text', 'plaintext', ''].includes(node.lang ?? '') ? node.value : '';
  if (node.type === 'break') return '\n';
  if ('value' in node) return node.value;
  if ('children' in node) {
    const separator = ['root', 'list', 'listItem', 'blockquote'].includes(node.type) ? '\n' : '';
    return node.children.map(plainText).join(separator);
  }
  return '';
}

export function markdownSections(
  body: string,
  title: string,
): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];
  const headings: string[] = [];
  let content: string[] = [];
  const flush = (): void => {
    const text = content.join('\n\n').trim();
    if (text)
      sections.push({
        heading: [title, ...headings.filter(Boolean)]
          .filter((v, i, a) => i === 0 || v !== a[i - 1])
          .join(' > '),
        content: text,
      });
    content = [];
  };
  for (const node of fromMarkdown(body).children) {
    if (node.type === 'heading') {
      flush();
      headings.length = node.depth;
      headings[node.depth - 1] = plainText(node);
    } else {
      const text = plainText(node).trim();
      if (text) content.push(text);
    }
  }
  flush();
  return sections;
}

/** Character boundaries avoid splitting a Cyrillic character/emoji across BPE tokens. */
function fittingPrefix(points: string[], start: number, budget: number, prefix: string): number {
  let low = start;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(prefix + points.slice(start, mid).join('')) <= budget) low = mid;
    else high = mid - 1;
  }
  // BPE counts are not strictly monotonic; the final count is authoritative.
  while (low > start && countTokens(prefix + points.slice(start, low).join('')) > budget) low--;
  return low;
}

export function chunkMarkdown(
  body: string,
  title: string,
  targetTokens: number,
  overlapTokens: number,
): PreviewChunk[] {
  if (
    !Number.isInteger(targetTokens) ||
    targetTokens < 64 ||
    !Number.isInteger(overlapTokens) ||
    overlapTokens < 0 ||
    overlapTokens >= targetTokens / 2
  ) {
    throw new Error('Invalid chunk token budget');
  }
  const chunks: PreviewChunk[] = [];
  for (const section of markdownSections(body, title)) {
    const prefix = `${section.heading}\n\n`;
    if (countTokens(prefix) > targetTokens / 2)
      throw new Error('Heading exceeds half the chunk budget');
    const points = Array.from(section.content);
    let start = 0;
    while (start < points.length) {
      let end = fittingPrefix(points, start, targetTokens, prefix);
      if (end <= start) throw new Error('Cannot fit a character within the chunk token budget');
      // Prefer a nearby paragraph/word boundary without creating tiny chunks.
      if (end < points.length) {
        for (let pos = end - 1; pos > start + (end - start) * 0.75; pos--) {
          if (
            /\s/u.test(points[pos] ?? '') &&
            countTokens(prefix + points.slice(start, pos + 1).join('')) <= targetTokens
          ) {
            end = pos + 1;
            break;
          }
        }
      }
      const content = points.slice(start, end).join('');
      const embeddingText = prefix + content;
      const tokenCount = countTokens(embeddingText);
      if (tokenCount > targetTokens) throw new Error('Chunk token budget exceeded');
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content,
        embeddingText,
        contentHash: hashText(embeddingText),
        tokenCount,
      });
      if (end === points.length) break;
      let next = end;
      // Overlap is bounded both by tokens and by half of the previous characters,
      // guaranteeing progress even for long whitespace runs.
      const earliest = Math.max(start + 1, end - Math.floor((end - start) / 2));
      while (next > earliest && countTokens(points.slice(next - 1, end).join('')) <= overlapTokens)
        next--;
      start = next;
    }
  }
  return chunks;
}
