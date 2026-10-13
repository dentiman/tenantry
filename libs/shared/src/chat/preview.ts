import { CHAT_PREVIEW_CHARS } from '@saas-skeleton/contracts';

/** Прев'ю в списку розмов — плоский однорядковий зріз тіла (спільне для API і ingest) */
export function toPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > CHAT_PREVIEW_CHARS ? `${flat.slice(0, CHAT_PREVIEW_CHARS - 1)}…` : flat;
}
