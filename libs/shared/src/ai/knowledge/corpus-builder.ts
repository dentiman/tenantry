import { createHash } from 'node:crypto';

/**
 * Збирач корпусу знань рівня 1 (docs/ai-assistant.md §7.2, ai-1b design.md D1–D4).
 *
 * ЧИСТІ ФУНКЦІЇ, лише вбудовані модулі Node і лише «стирабельний» TypeScript (без enum,
 * parameter properties, namespace) і БЕЗ відносних імпортів: цей файл напряму запускає
 * `node scripts/ai-knowledge.ts` (type stripping Node 24) — у CI без `pnpm install`.
 * Тому тут немає ні Zod, ні YAML-бібліотеки: front-matter — чотири пласкі ключі.
 */

/** Бюджет рівня 1 — у СИМВОЛАХ, не в токенах (§10.1: точний рахунок відкладено) */
export const AI_KNOWLEDGE_CHAR_BUDGET = 100_000;

export const KNOWLEDGE_AUDIENCES = ['all', 'admin'] as const;
export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];

export interface KnowledgeCorpusDocument {
  readonly slug: string;
  readonly title: string;
  readonly audience: KnowledgeAudience;
  readonly area: string;
  readonly body: string;
}

export interface KnowledgeCorpus {
  /** Версія знань — хеш вмісту; пишеться в `ai_messages.knowledge_version` */
  readonly version: string;
  readonly totalChars: number;
  readonly documents: readonly KnowledgeCorpusDocument[];
}

export interface KnowledgeSourceFile {
  /** Ім'я файлу в `docs/ai-knowledge/`, напр. `02-customers.md` */
  readonly name: string;
  readonly text: string;
}

export class KnowledgeCorpusError extends Error {
  override readonly name = 'KnowledgeCorpusError';
}

const FILE_NAME = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONT_MATTER_KEYS = ['slug', 'title', 'audience', 'area'] as const;
type FrontMatterKey = (typeof FRONT_MATTER_KEYS)[number];

function isFrontMatterKey(key: string): key is FrontMatterKey {
  return (FRONT_MATTER_KEYS as readonly string[]).includes(key);
}

function isAudience(value: string): value is KnowledgeAudience {
  return (KNOWLEDGE_AUDIENCES as readonly string[]).includes(value);
}

function fail(file: string, message: string): never {
  throw new KnowledgeCorpusError(`${file}: ${message}`);
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Один файл → документ. Помилка завжди називає файл і поле — людина, що правила
 * документацію, має побачити, ЩО саме не так, а не «invalid corpus».
 */
export function parseKnowledgeFile(file: KnowledgeSourceFile): KnowledgeCorpusDocument {
  const nameMatch = FILE_NAME.exec(file.name);
  if (!nameMatch) {
    fail(file.name, 'file name must look like "NN-slug.md" (two digits, kebab-case slug)');
  }
  const text = file.text.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    fail(file.name, 'front-matter must open with "---" on the first line');
  }
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) {
    fail(file.name, 'front-matter is not closed with "---"');
  }

  const fields = new Map<FrontMatterKey, string>();
  for (const raw of text.slice(4, end).split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      fail(file.name, `front-matter line "${line}" is not "key: value"`);
    }
    const key = line.slice(0, colon).trim();
    if (!isFrontMatterKey(key)) {
      fail(
        file.name,
        `unknown front-matter field "${key}" (allowed: ${FRONT_MATTER_KEYS.join(', ')})`,
      );
    }
    if (fields.has(key)) {
      fail(file.name, `front-matter field "${key}" is repeated`);
    }
    fields.set(key, unquote(line.slice(colon + 1).trim()));
  }

  const field = (key: FrontMatterKey): string => {
    const value = fields.get(key);
    if (value === undefined || value === '') {
      fail(file.name, `front-matter field "${key}" is required`);
    }
    return value;
  };

  const slug = field('slug');
  if (!KEBAB.test(slug)) {
    fail(file.name, `front-matter field "slug" must be kebab-case, got "${slug}"`);
  }
  if (slug !== nameMatch[2]) {
    fail(
      file.name,
      `front-matter field "slug" must match the file name ("${String(nameMatch[2])}")`,
    );
  }
  const audience = field('audience');
  if (!isAudience(audience)) {
    fail(
      file.name,
      `front-matter field "audience" must be one of ${KNOWLEDGE_AUDIENCES.join(' | ')}, got "${audience}"`,
    );
  }
  const area = field('area');
  if (!KEBAB.test(area)) {
    fail(file.name, `front-matter field "area" must be kebab-case, got "${area}"`);
  }

  const body = text.slice(end + '\n---\n'.length).trim();
  if (body === '') {
    fail(file.name, 'document body is empty');
  }

  // Порядок ключів тут — КАНОНІЧНИЙ: від нього залежить хеш версії (design.md D2)
  return { slug, title: field('title'), audience, area, body };
}

/** Символи, що реально доходять до промпту: заголовок + тіло (front-matter — ні) */
export function countKnowledgeChars(documents: readonly KnowledgeCorpusDocument[]): number {
  return documents.reduce((sum, doc) => sum + doc.title.length + doc.body.length, 0);
}

/**
 * Версія — перші 16 hex SHA-256 від КАНОНІЧНОГО списку документів, а не від сирих
 * файлів: перестановка ключів front-matter версію не змінює, а будь-який байт, що
 * бачить модель, — змінює (design.md D2).
 */
export function computeKnowledgeVersion(documents: readonly KnowledgeCorpusDocument[]): string {
  const canonical = documents.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    audience: doc.audience,
    area: doc.area,
    body: doc.body,
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

export function buildKnowledgeCorpus(
  files: readonly KnowledgeSourceFile[],
  budget: number = AI_KNOWLEDGE_CHAR_BUDGET,
): KnowledgeCorpus {
  if (files.length === 0) {
    throw new KnowledgeCorpusError('no knowledge documents found');
  }
  // Порядок за іменем файлу (`00-…` … `12-…`) — стабільний префікс промпту між регенераціями
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const documents = sorted.map(parseKnowledgeFile);

  const seen = new Map<string, string>();
  documents.forEach((doc, index) => {
    const name = sorted[index]?.name ?? doc.slug;
    const previous = seen.get(doc.slug);
    if (previous !== undefined) {
      fail(name, `slug "${doc.slug}" is already used by ${previous}`);
    }
    seen.set(doc.slug, name);
  });

  const totalChars = countKnowledgeChars(documents);
  if (totalChars > budget) {
    throw new KnowledgeCorpusError(
      `knowledge corpus is ${String(totalChars)} characters, over the budget of ${String(budget)}`,
    );
  }

  return { version: computeKnowledgeVersion(documents), totalChars, documents };
}

/** Детерміноване подання артефакту: чиста функція теки, без часу й абсолютних шляхів */
export function serializeKnowledgeCorpus(corpus: KnowledgeCorpus): string {
  return `${JSON.stringify(
    { version: corpus.version, totalChars: corpus.totalChars, documents: corpus.documents },
    null,
    2,
  )}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Перевірка форми ЗАКОМІЧЕНОГО артефакту під час старту воркера: форма, бюджет і те,
 * що версія справді відповідає вмісту (артефакт, поправлений руками, не пройде).
 */
export function parseKnowledgeCorpus(value: unknown): KnowledgeCorpus {
  const invalid = (message: string): never => {
    throw new KnowledgeCorpusError(`knowledge artifact: ${message}`);
  };
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    return invalid('expected { version, totalChars, documents[] }');
  }
  const documents = value.documents.map((raw: unknown, index): KnowledgeCorpusDocument => {
    if (!isRecord(raw)) {
      return invalid(`document ${String(index)} is not an object`);
    }
    const { slug, title, audience, area, body } = raw;
    if (
      typeof slug !== 'string' ||
      typeof title !== 'string' ||
      typeof area !== 'string' ||
      typeof body !== 'string' ||
      typeof audience !== 'string' ||
      !isAudience(audience)
    ) {
      return invalid(`document ${String(index)} has an invalid shape`);
    }
    return { slug, title, audience, area, body };
  });
  const version = computeKnowledgeVersion(documents);
  if (value.version !== version) {
    invalid(
      `version ${String(value.version)} does not match its content (${version}) — run pnpm ai:knowledge`,
    );
  }
  const totalChars = countKnowledgeChars(documents);
  if (totalChars > AI_KNOWLEDGE_CHAR_BUDGET) {
    invalid(
      `${String(totalChars)} characters, over the budget of ${String(AI_KNOWLEDGE_CHAR_BUDGET)}`,
    );
  }
  return { version, totalChars, documents };
}
