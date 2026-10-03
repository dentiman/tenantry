import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkMarkdown, countTokens, hashText } from './chunker';
import { SourceManifestSchema } from './manifest';
import { previewSource, serializePreview } from './preview';

const manifest = {
  sourceKey: 'fms',
  product: 'fms',
  allowedDirectories: ['010_business'],
  languages: ['en', 'uk', 'ru'],
  audienceMapping: { all: ['ADMIN', 'USER'], root_admin: [] },
  chunking: { targetTokens: 100, overlapTokens: 12 },
  draftApprovals: [],
};
const today = new Date('2026-10-03T12:00:00Z');
const document = (fields = '', body = 'Business instructions.', id = 'TEST-01'): string =>
  `---\ntitle: Setup\ncanonical_id: ${id}\nlanguage: uk\naudience: [all]\nstatus: current\n${fields}---\n# Setup\n\n${body}\n`;
let root: string;
const write = (name: string, text: string): void => {
  writeFileSync(join(root, name), text);
};
const preview = (policy: unknown = manifest): ReturnType<typeof previewSource> =>
  previewSource(root, policy, today);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fms-preview-'));
  mkdirSync(join(root, '010_business'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('source admission and deterministic offline preview', () => {
  it.each(['current', 'draft', 'historical', 'planned', undefined])(
    'admits status %s and draft flag only with the explicit test policy',
    (status) => {
      const text = document('draft: true\ndoc_type: business_rule\n').replace(
        'status: current\n',
        status === undefined ? '' : `status: ${status}\n`,
      );
      write('010_business/a.md', text);
      expect(preview().totals.documents).toBe(0);
      const result = preview({ ...manifest, statusPolicy: 'all-for-testing' });
      expect(result.totals.documents).toBe(1);
      expect(result.revision).not.toBe(preview().revision);
    },
  );

  it('test policy still excludes Russian, technical types, unpublished and outside paths', () => {
    const policy = {
      ...manifest,
      statusPolicy: 'all-for-testing',
      languages: ['en', 'uk'],
      allowedDocumentTypes: ['business_rule'],
    };
    write('010_business/a.md', document('doc_type: business_rule\n'));
    write(
      '010_business/ru.md',
      document('doc_type: business_rule\n').replace('language: uk', 'language: ru'),
    );
    write('010_business/api.md', document('doc_type: api\n'));
    write('010_business/untyped.md', document());
    write('010_business/private.md', document('publish: false\ndoc_type: business_rule\n'));
    for (const directory of ['200_engineering', '300_workbench', 'ru']) {
      mkdirSync(join(root, directory));
      write(`${directory}/a.md`, document('doc_type: business_rule\n'));
    }
    const result = preview(policy);
    expect(result.totals.documents).toBe(1);
    expect(result.rejected.map((item) => item.reason).sort()).toEqual([
      'document-type-not-allowed',
      'document-type-not-allowed',
      'language-not-allowed',
      'path-not-allowed',
      'path-not-allowed',
      'path-not-allowed',
      'publish-false',
    ]);
  });

  it('hashes the original UTF-8 bytes including BOM and CRLF', () => {
    const text = '\uFEFF' + document().replaceAll('\n', '\r\n');
    write('010_business/a.md', text);
    expect(preview().documents[0]?.fileHash).toBe(hashText(text));
  });

  it('counts full embedding text, is deterministic and omits content from the default report', () => {
    write('010_business/a.md', document());
    const result = preview();
    expect(result.totals).toMatchObject({ documents: 1, rejected: 0, chunks: 1 });
    const chunk = result.documents[0]?.chunks[0];
    expect(result.totals.embeddingTokens).toBe(countTokens(chunk?.embeddingText ?? ''));
    expect(serializePreview(result)).toBe(serializePreview(preview()));
    expect(serializePreview(result)).not.toContain('Business instructions.');
    expect(serializePreview(result, true)).toContain('Business instructions.');
    expect(result.documents[0]?.audience).toEqual(['ADMIN', 'USER']);
  });

  it.each([
    ['publish-false', document('publish: false\n')],
    ['status-not-current', document('draft: true\n')],
    ['draft-not-approved', document().replace('status: current', 'status: draft')],
    ['status-not-current', document().replace('status: current', 'status: historical')],
    ['language-not-allowed', document().replace('language: uk', 'language: de')],
    ['product-mismatch', document('product: other\n')],
    ['unknown-audience', document().replace('[all]', '[all, mystery]')],
    ['no-mapped-role', document().replace('[all]', '[root_admin]')],
    ['invalid-frontmatter', document('status: current\n')],
    ['invalid-metadata', document('publish: "false"\n')],
    ['missing-frontmatter', '# No metadata'],
    ['empty-content', document('', '```sql\nDROP TABLE users;\n```')],
  ])('rejects %s without admitting its body', (reason, text) => {
    write('010_business/a.md', text);
    expect(preview().rejected).toEqual([{ path: '010_business/a.md', reason }]);
    expect(preview().totals.documents).toBe(0);
  });

  it('requires a matching hash and unexpired review date for an explicitly approved draft', () => {
    const text = document().replace('status: current', 'status: draft');
    write('010_business/a.md', text);
    const approval = {
      path: '010_business/a.md',
      sha256: hashText(text),
      reviewer: 'content-owner',
      reviewAfter: '2026-10-04',
    };
    expect(preview({ ...manifest, draftApprovals: [approval] }).totals.documents).toBe(1);
    expect(
      preview({ ...manifest, draftApprovals: [{ ...approval, reviewAfter: '2026-10-03' }] }).totals
        .documents,
    ).toBe(0);
    write('010_business/a.md', text + 'Changed');
    expect(preview({ ...manifest, draftApprovals: [approval] }).totals.documents).toBe(0);
  });

  it('rejects aliases, links and oversized files; does not follow a linked directory', () => {
    write('outside.md', document());
    symlinkSync(join(root, 'outside.md'), join(root, '010_business/link.md'));
    symlinkSync(root, join(root, '010_business/loop'));
    write('010_business/large.md', 'x'.repeat(1_048_577));
    write(
      '010_business/alias.md',
      document().replace('audience: [all]', 'anchor: &roles [all]\naudience: *roles'),
    );
    const result = preview();
    expect(result.totals.documents).toBe(0);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual([
      'file-too-large',
      'invalid-metadata',
      'path-not-allowed',
      'symbolic-link',
      'symbolic-link',
    ]);
  });

  it('rejects every colliding canonical identity, not just the second', () => {
    write('010_business/a.md', document());
    write('010_business/b.md', document());
    expect(preview().rejected.map((r) => r.reason)).toEqual([
      'duplicate-identity',
      'duplicate-identity',
    ]);
    expect(preview().totals.documents).toBe(0);
  });

  it('revision includes content, policy and chunk profile; object key order does not matter', () => {
    write('010_business/a.md', document());
    const original = preview();
    expect(
      preview({ ...manifest, audienceMapping: { root_admin: [], all: ['ADMIN', 'USER'] } })
        .revision,
    ).toBe(original.revision);
    expect(
      preview({ ...manifest, audienceMapping: { all: ['ADMIN'], root_admin: [] } }).revision,
    ).not.toBe(original.revision);
    expect(
      preview({ ...manifest, chunking: { targetTokens: 120, overlapTokens: 12 } }).revision,
    ).not.toBe(original.revision);
    write('010_business/a.md', document('', 'Other instructions.'));
    expect(preview().revision).not.toBe(original.revision);
  });

  it.each(['../secret', '/etc', '010_business/../secret', 'C:\\secret', '010_business/'])(
    'rejects unsafe manifest directory %s',
    (path) => {
      expect(() =>
        SourceManifestSchema.parse({ ...manifest, allowedDirectories: [path] }),
      ).toThrow();
    },
  );
});

describe('section chunking', () => {
  it('keeps Cyrillic/emoji intact and counts headings and overlap within the budget', () => {
    const body = Array.from(
      { length: 160 },
      (_, i) => `Клієнт ${String(i)}: змінити тариф 🚀.`,
    ).join(' ');
    const chunks = chunkMarkdown(body, 'Інструкція', 100, 12);
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(countTokens(chunk.embeddingText));
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
      expect(chunk.content).not.toContain('\uFFFD');
      expect(body).toContain(chunk.content);
    }
    expect(chunks[0]?.content.startsWith('Клієнт 0:')).toBe(true);
    expect(chunks.at(-1)?.content.endsWith('🚀.')).toBe(true);
  });

  it('retains breadcrumbs and text diagrams while removing HTML and executable code', () => {
    const chunks = chunkMarkdown(
      '# Setup\n## Billing\nPay **invoice**.\n<script>bad()</script>\n\n```sql\nSELECT secret;\n```\n\n```text\nA -> B\n```\n## Users\nAdd user.',
      'Manual',
      100,
      12,
    );
    expect(chunks.map((c) => c.heading)).toEqual([
      'Manual > Setup > Billing',
      'Manual > Setup > Users',
    ]);
    const text = chunks.map((c) => c.content).join('\n');
    expect(text).toContain('Pay invoice.');
    expect(text).toContain('A -> B');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('bad()');
  });

  it('accepts literal tokenizer control-token text and rejects invalid budgets', () => {
    expect(chunkMarkdown('Literal <|endoftext|> marker.', 'Setup', 100, 0)).toHaveLength(1);
    expect(() => chunkMarkdown('body', 'title', 100, 100)).toThrow();
    expect(() => chunkMarkdown('body', 'word '.repeat(300), 100, 12)).toThrow();
  });
});
