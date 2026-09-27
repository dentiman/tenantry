import { describe, expect, it } from 'vitest';
import { ApiErrorCodeSchema } from '@saas-skeleton/contracts';
import errorsEn from '../../../../i18n/src/locales/en/errors.json';
import bundledCorpus from './generated/knowledge-corpus.json';
import {
  AI_KNOWLEDGE_CHAR_BUDGET,
  buildKnowledgeCorpus,
  serializeKnowledgeCorpus,
  type KnowledgeSourceFile,
} from './corpus-builder';
import { StaticKnowledgeSource } from './static-knowledge-source';

function file(
  name: string,
  slug: string,
  audience: 'all' | 'admin',
  body: string,
): KnowledgeSourceFile {
  return {
    name,
    text: `---\nslug: ${slug}\ntitle: ${slug}\naudience: ${audience}\narea: general\n---\n${body}\n`,
  };
}

const fixture = JSON.parse(
  serializeKnowledgeCorpus(
    buildKnowledgeCorpus([
      file('00-intro.md', 'intro', 'all', 'Intro body'),
      file('01-admin-only.md', 'admin-only', 'admin', 'Admin body'),
      file('02-outro.md', 'outro', 'all', 'Outro body'),
    ]),
  ),
) as unknown;

describe('StaticKnowledgeSource', () => {
  it('USER не отримує документів `audience: admin`, порядок зберігається', async () => {
    const selection = await new StaticKnowledgeSource(fixture).select({
      role: 'USER',
      question: 'q',
    });
    expect(selection.documents.map((d) => d.slug)).toEqual(['intro', 'outro']);
  });

  it('ADMIN отримує всі документи в порядку артефакту', async () => {
    const selection = await new StaticKnowledgeSource(fixture).select({
      role: 'ADMIN',
      question: 'q',
    });
    expect(selection.documents.map((d) => d.slug)).toEqual(['intro', 'admin-only', 'outro']);
  });

  it('версія однакова для обох ролей і дорівнює версії артефакту', async () => {
    const source = new StaticKnowledgeSource(fixture);
    const user = await source.select({ role: 'USER', question: 'q' });
    const admin = await source.select({ role: 'ADMIN', question: 'q' });
    expect(user.version).toBe((fixture as { version: string }).version);
    expect(admin.version).toBe(user.version);
  });

  it('у промпт іде лише slug/title/body — без audience/area', async () => {
    const selection = await new StaticKnowledgeSource(fixture).select({
      role: 'ADMIN',
      question: 'q',
    });
    expect(selection.documents[0]).toEqual({ slug: 'intro', title: 'intro', body: 'Intro body' });
  });

  it('зіпсований артефакт відкидається вже в конструкторі (старт воркера)', () => {
    expect(() => new StaticKnowledgeSource({ version: 'x', documents: [] })).toThrow(
      /does not match/,
    );
    expect(() => new StaticKnowledgeSource(null)).toThrow(/knowledge artifact/);
  });
});

describe('закомічений корпус (docs/ai-knowledge → knowledge-corpus.json)', () => {
  it('вантажиться, вкладається в бюджет, має 13 документів', async () => {
    const selection = await new StaticKnowledgeSource().select({ role: 'ADMIN', question: '' });
    expect(selection.documents).toHaveLength(13);
    expect(bundledCorpus.totalChars).toBeLessThanOrEqual(AI_KNOWLEDGE_CHAR_BUDGET);
  });

  it('USER не бачить документів адміна (users-and-roles, settings-organization)', async () => {
    const selection = await new StaticKnowledgeSource().select({ role: 'USER', question: '' });
    const slugs = selection.documents.map((d) => d.slug);
    expect(slugs).not.toContain('users-and-roles');
    expect(slugs).not.toContain('settings-organization');
    expect(slugs).toHaveLength(11);
  });

  /**
   * Точність ярликів (design.md D10): troubleshooting мусить цитувати РІВНО те
   * повідомлення, яке фронт рендерить для кожного `ApiError.code` (libs/i18n), і
   * покривати ВЕСЬ закритий enum контракту — новий код без рядка тут валить тест.
   */
  it('10-troubleshooting цитує точне повідомлення для кожного ApiError.code', () => {
    const doc = bundledCorpus.documents.find((d) => d.slug === 'troubleshooting');
    expect(doc).toBeDefined();
    const rows = new Map<string, string>();
    for (const match of (doc?.body ?? '').matchAll(/^\| `([A-Z_]+)` \| "([^"]+)" \|/gm)) {
      rows.set(match[1] ?? '', match[2] ?? '');
    }

    const codes: Record<string, string> = errorsEn.codes;
    expect([...rows.keys()].sort()).toEqual([...ApiErrorCodeSchema.options].sort());
    for (const code of ApiErrorCodeSchema.options) {
      expect(rows.get(code), code).toBe(codes[code]);
    }
  });
});
