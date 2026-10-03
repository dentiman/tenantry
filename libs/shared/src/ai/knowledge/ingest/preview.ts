import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { KNOWLEDGE_EMBEDDING_DIMENSIONS, KNOWLEDGE_EMBEDDING_MODEL } from '../embedding-provider';
import { chunkMarkdown, hashText, PARSER_VERSION, type PreviewChunk } from './chunker';
import { DocumentMetadataSchema, SourceManifestSchema, type SourceManifest } from './manifest';

export interface PreviewDocument {
  path: string;
  canonicalId: string;
  title: string;
  language: string;
  audience: ('ADMIN' | 'USER')[];
  fileHash: string;
  contentHash: string;
  chunks: PreviewChunk[];
}
export interface PreviewRejection {
  path: string;
  reason: string;
}
export interface SourcePreview {
  sourceKey: string;
  product: string;
  revision: string;
  manifestHash: string;
  parserVersion: string;
  embeddingModel: string;
  dimensions: number;
  tokenizer: string;
  documents: PreviewDocument[];
  rejected: PreviewRejection[];
  totals: { documents: number; rejected: number; chunks: number; embeddingTokens: number };
}

const MAX_FILE_BYTES = 1_048_576;
const MAX_ENTRIES = 10_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function admittedFile(
  path: string,
  text: string,
  manifest: SourceManifest,
  today: string,
): PreviewDocument {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
  if (!frontmatter) throw new Error('missing-frontmatter');
  const parsed = parseDocument(frontmatter[1] ?? '', { uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('invalid-frontmatter');
  let metadata: ReturnType<typeof DocumentMetadataSchema.parse>;
  try {
    metadata = DocumentMetadataSchema.parse(parsed.toJS({ maxAliasCount: 0 }) as unknown);
  } catch {
    throw new Error('invalid-metadata');
  }
  if (metadata.publish === false) throw new Error('publish-false');
  if (metadata.product !== undefined && metadata.product !== manifest.product)
    throw new Error('product-mismatch');
  if (!manifest.languages.some((language) => language === metadata.language))
    throw new Error('language-not-allowed');
  if (
    manifest.allowedDocumentTypes &&
    (!metadata.doc_type || !manifest.allowedDocumentTypes.includes(metadata.doc_type))
  )
    throw new Error('document-type-not-allowed');
  const fileHash = hashText(text);
  if (manifest.statusPolicy === 'current-or-approved') {
    if (metadata.status === 'draft') {
      const approved = manifest.draftApprovals.some(
        (approval) =>
          approval.path === path && approval.sha256 === fileHash && approval.reviewAfter > today,
      );
      if (!approved) throw new Error('draft-not-approved');
    } else if (metadata.status !== 'current' || metadata.draft === true)
      throw new Error('status-not-current');
  }
  const roles = new Set<'ADMIN' | 'USER'>();
  for (const audience of metadata.audience) {
    if (!Object.hasOwn(manifest.audienceMapping, audience)) throw new Error('unknown-audience');
    for (const role of manifest.audienceMapping[audience] ?? []) roles.add(role);
  }
  if (!roles.size) throw new Error('no-mapped-role');
  const body = normalized.slice(frontmatter[0].length);
  const chunks = chunkMarkdown(
    body,
    metadata.title,
    manifest.chunking.targetTokens,
    manifest.chunking.overlapTokens,
  );
  if (!chunks.length) throw new Error('empty-content');
  return {
    path,
    canonicalId: metadata.canonical_id,
    title: metadata.title,
    language: metadata.language,
    audience: [...roles].sort(),
    fileHash,
    contentHash: hashText(chunks.map((chunk) => chunk.contentHash).join('\n')),
    chunks,
  };
}

/** Read-only filesystem boundary. No database/provider imports or calls. */
export function previewSource(rootPath: string, input: unknown, now = new Date()): SourcePreview {
  const manifest = SourceManifestSchema.parse(input);
  const root = realpathSync(rootPath);
  const today = now.toISOString().slice(0, 10);
  const documents: PreviewDocument[] = [];
  const rejected: PreviewRejection[] = [];
  let entries = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (++entries > MAX_ENTRIES) throw new Error('Source exceeds 10000 filesystem entries');
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        rejected.push({ path, reason: 'symbolic-link' });
        continue;
      }
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) visit(absolute);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      if (!entry.isFile()) {
        rejected.push({ path, reason: 'not-regular-file' });
        continue;
      }
      if (!manifest.allowedDirectories.some((allowed) => path.startsWith(`${allowed}/`))) {
        rejected.push({ path, reason: 'path-not-allowed' });
        continue;
      }
      let descriptor: number | undefined;
      try {
        const resolved = relative(root, realpathSync(absolute));
        if (resolved === '..' || resolved.startsWith(`..${sep}`) || isAbsolute(resolved))
          throw new Error('outside-root');
        descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('file-too-large');
        const bytes = readFileSync(descriptor);
        if (bytes.length > MAX_FILE_BYTES) throw new Error('file-too-large');
        // Preserve the BOM for the raw-file hash; parsing normalizes it separately.
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        documents.push(admittedFile(path, text, manifest, today));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unreadable-file';
        // Do not expose absolute paths from filesystem/YAML errors in the report.
        rejected.push({ path, reason: /^[a-z-]+$/.test(reason) ? reason : 'parse-or-read-error' });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    }
  };
  visit(root);
  // Reject ALL colliding identities; picking the first would depend on directory order.
  const identities = new Map<string, number>();
  for (const doc of documents) {
    const identity = JSON.stringify([doc.canonicalId, doc.language]);
    identities.set(identity, (identities.get(identity) ?? 0) + 1);
  }
  const admitted = documents.filter((doc) => {
    if ((identities.get(JSON.stringify([doc.canonicalId, doc.language])) ?? 0) > 1) {
      rejected.push({ path: doc.path, reason: 'duplicate-identity' });
      return false;
    }
    return true;
  });
  rejected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifestHash = hashText(canonical(manifest));
  const revision = hashText(
    canonical({
      manifestHash,
      parser: PARSER_VERSION,
      model: KNOWLEDGE_EMBEDDING_MODEL,
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      files: admitted.map((doc) => [doc.path, doc.fileHash]),
    }),
  );
  return {
    sourceKey: manifest.sourceKey,
    product: manifest.product,
    revision,
    manifestHash,
    parserVersion: PARSER_VERSION,
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    tokenizer: 'cl100k_base',
    documents: admitted,
    rejected,
    totals: {
      documents: admitted.length,
      rejected: rejected.length,
      chunks: admitted.reduce((sum, doc) => sum + doc.chunks.length, 0),
      embeddingTokens: admitted.reduce(
        (sum, doc) => sum + doc.chunks.reduce((n, chunk) => n + chunk.tokenCount, 0),
        0,
      ),
    },
  };
}

export function serializePreview(preview: SourcePreview, includeContent = false): string {
  return `${JSON.stringify(
    {
      ...preview,
      documents: preview.documents.map((document) => ({
        ...document,
        chunks: document.chunks.map(({ content, embeddingText, ...metadata }) =>
          includeContent ? { ...metadata, content, embeddingText } : metadata,
        ),
      })),
    },
    null,
    2,
  )}\n`;
}
