/**
 * Генератор і перевірка корпусу знань AI-асистента (docs/ai-assistant.md §7.2, ai-1b D4).
 *
 *   pnpm ai:knowledge         docs/ai-knowledge/*.md → libs/shared/.../knowledge-corpus.json
 *   pnpm ai:knowledge:check   артефакт не розійшовся з текою, front-matter валідний,
 *                             корпус у бюджеті символів; exit 1 інакше
 *
 * Запускається ГОЛИМ `node` (type stripping Node 24), без `pnpm install` — саме так
 * його ганяє CI у стоковому контейнері. Тому: лише вбудовані модулі й імпорт збирача
 * з явним `.ts`. Уся логіка — у збирачі (там же тести); тут тільки I/O.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_KNOWLEDGE_CHAR_BUDGET,
  KnowledgeCorpusError,
  buildKnowledgeCorpus,
  serializeKnowledgeCorpus,
} from '../libs/shared/src/ai/knowledge/corpus-builder.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'docs/ai-knowledge');
const artifactPath = join(root, 'libs/shared/src/ai/knowledge/generated/knowledge-corpus.json');
const check = process.argv.includes('--check');

function readCommitted(): string | null {
  try {
    return readFileSync(artifactPath, 'utf8');
  } catch {
    return null;
  }
}

function main(): number {
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, text: readFileSync(join(sourceDir, name), 'utf8') }));

  const corpus = buildKnowledgeCorpus(files);
  const serialized = serializeKnowledgeCorpus(corpus);
  const summary =
    `${String(corpus.documents.length)} documents, ${String(corpus.totalChars)} / ` +
    `${String(AI_KNOWLEDGE_CHAR_BUDGET)} characters, version ${corpus.version}`;
  const artifact = relative(root, artifactPath);

  if (check) {
    if (readCommitted() !== serialized) {
      console.error(
        `ai:knowledge: ${artifact} is stale against docs/ai-knowledge — run pnpm ai:knowledge`,
      );
      return 1;
    }
    console.log(`ai:knowledge: up to date (${summary})`);
    return 0;
  }

  writeFileSync(artifactPath, serialized);
  console.log(`ai:knowledge: wrote ${artifact} (${summary})`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof KnowledgeCorpusError) {
    console.error(`ai:knowledge: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
