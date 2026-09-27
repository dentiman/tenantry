import { describe, expect, it } from 'vitest';
import {
  AI_KNOWLEDGE_CHAR_BUDGET,
  buildKnowledgeCorpus,
  parseKnowledgeCorpus,
  parseKnowledgeFile,
  serializeKnowledgeCorpus,
  type KnowledgeSourceFile,
} from './corpus-builder';

function doc(
  name: string,
  fields: Record<string, string>,
  body = 'Some body text.',
): KnowledgeSourceFile {
  const front = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return { name, text: `---\n${front}\n---\n\n${body}\n` };
}

const valid = (overrides: Record<string, string> = {}, body?: string): KnowledgeSourceFile =>
  doc(
    '02-customers.md',
    { slug: 'customers', title: 'Customers', audience: 'all', area: 'workspace', ...overrides },
    body,
  );

describe('parseKnowledgeFile', () => {
  it('розбирає front-matter і тіло', () => {
    expect(parseKnowledgeFile(valid({ title: '"Customers and contacts"' }, '# H\n\nText'))).toEqual(
      {
        slug: 'customers',
        title: 'Customers and contacts',
        audience: 'all',
        area: 'workspace',
        body: '# H\n\nText',
      },
    );
  });

  it('CRLF нормалізується — версія не залежить від ОС автора', () => {
    const lf = valid();
    const crlf = { name: lf.name, text: lf.text.replace(/\n/g, '\r\n') };
    expect(parseKnowledgeFile(crlf)).toEqual(parseKnowledgeFile(lf));
  });

  it.each(['slug', 'title', 'audience', 'area'])(
    'відсутнє поле "%s" названо разом з файлом',
    (key) => {
      const fields: Record<string, string> = {
        slug: 'customers',
        title: 'Customers',
        audience: 'all',
        area: 'workspace',
      };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- тест прибирає рівно одне поле
      delete fields[key];
      expect(() => parseKnowledgeFile(doc('02-customers.md', fields))).toThrow(
        `02-customers.md: front-matter field "${key}" is required`,
      );
    },
  );

  it('невідома аудиторія — помилка з назвою поля', () => {
    expect(() => parseKnowledgeFile(valid({ audience: 'managers' }))).toThrow(
      /02-customers\.md: front-matter field "audience" must be one of all \| admin/,
    );
  });

  it('невідоме поле front-matter — помилка', () => {
    expect(() => parseKnowledgeFile(valid({ tags: 'x' }))).toThrow(
      /unknown front-matter field "tags"/,
    );
  });

  it('slug мусить збігатися з іменем файлу', () => {
    expect(() => parseKnowledgeFile(valid({ slug: 'clients' }))).toThrow(
      /must match the file name/,
    );
  });

  it('погане імʼя файлу, відсутній front-matter, порожнє тіло', () => {
    expect(() => parseKnowledgeFile({ name: 'customers.md', text: '' })).toThrow(/file name/);
    expect(() =>
      parseKnowledgeFile({ name: '02-customers.md', text: '# no front-matter' }),
    ).toThrow(/must open with/);
    expect(() => parseKnowledgeFile(valid({}, '   '))).toThrow(/document body is empty/);
  });
});

describe('buildKnowledgeCorpus', () => {
  const files = [
    doc('01-navigation.md', {
      slug: 'navigation',
      title: 'Navigation',
      audience: 'all',
      area: 'general',
    }),
    doc('00-getting-started.md', {
      slug: 'getting-started',
      title: 'Start',
      audience: 'all',
      area: 'general',
    }),
    doc('04-users.md', { slug: 'users', title: 'Users', audience: 'admin', area: 'settings' }),
  ];

  it('упорядковує документи за іменем файлу', () => {
    const corpus = buildKnowledgeCorpus(files);
    expect(corpus.documents.map((d) => d.slug)).toEqual(['getting-started', 'navigation', 'users']);
  });

  it('версія детермінована й не залежить від порядку вводу', () => {
    const a = buildKnowledgeCorpus(files);
    const b = buildKnowledgeCorpus([...files].reverse());
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(b.version).toBe(a.version);
    expect(serializeKnowledgeCorpus(b)).toBe(serializeKnowledgeCorpus(a));
  });

  it('зміна тіла змінює версію; перестановка ключів front-matter — ні', () => {
    const base = buildKnowledgeCorpus([valid()]);
    const edited = buildKnowledgeCorpus([valid({}, 'Some body text!')]);
    const reordered = buildKnowledgeCorpus([
      doc('02-customers.md', {
        area: 'workspace',
        audience: 'all',
        title: 'Customers',
        slug: 'customers',
      }),
    ]);
    expect(edited.version).not.toBe(base.version);
    expect(reordered.version).toBe(base.version);
  });

  it('рахує символи заголовків і тіл', () => {
    const corpus = buildKnowledgeCorpus([valid({}, '12345')]);
    expect(corpus.totalChars).toBe('Customers'.length + 5);
  });

  it('перевищення бюджету — помилка з розміром і бюджетом', () => {
    expect(() => buildKnowledgeCorpus([valid({}, 'x'.repeat(100))], 50)).toThrow(
      'knowledge corpus is 109 characters, over the budget of 50',
    );
    expect(AI_KNOWLEDGE_CHAR_BUDGET).toBe(100_000);
  });

  it('дубль slug — помилка', () => {
    const dup = doc('03-customers.md', {
      slug: 'customers',
      title: 'X',
      audience: 'all',
      area: 'workspace',
    });
    // slug мусить збігатися з імʼям файлу, тож дубль можливий лише з різними номерами
    expect(() => buildKnowledgeCorpus([valid(), dup])).toThrow(
      /slug "customers" is already used by 02-customers\.md/,
    );
  });

  it('порожня тека — помилка', () => {
    expect(() => buildKnowledgeCorpus([])).toThrow(/no knowledge documents/);
  });
});

describe('parseKnowledgeCorpus', () => {
  it('приймає власний серіалізований артефакт', () => {
    const corpus = buildKnowledgeCorpus([valid()]);
    expect(parseKnowledgeCorpus(JSON.parse(serializeKnowledgeCorpus(corpus)))).toEqual(corpus);
  });

  it('відкидає артефакт, поправлений руками (версія не відповідає вмісту)', () => {
    const corpus = JSON.parse(serializeKnowledgeCorpus(buildKnowledgeCorpus([valid()]))) as {
      documents: { body: string }[];
    };
    const first = corpus.documents[0];
    if (first) {
      first.body = 'tampered';
    }
    expect(() => parseKnowledgeCorpus(corpus)).toThrow(/does not match its content/);
  });

  it('відкидає хибну форму', () => {
    expect(() => parseKnowledgeCorpus({})).toThrow(/expected/);
    expect(() => parseKnowledgeCorpus({ version: 'x', documents: [{ slug: 1 }] })).toThrow(
      /invalid shape/,
    );
  });
});
