/**
 * Інформація про збірку для футера tenant-web: версія + історія проєкту.
 *
 *   node scripts/build-info.ts     → JSON у stdout (його читає apps/web/vite.config.ts → `define`)
 *
 * Запускається ГОЛИМ `node` (type stripping Node 24), лише вбудовані модулі — як
 * `ai-knowledge.ts`. Нічого не пише на диск: у дереві немає згенерованого файлу, який міг би
 * розійтися з джерелом або конфліктувати між worktree-ами.
 *
 * Версія = `<major>.<minor>` з кореневого `package.json` + номер збірки останньою частиною.
 * Номер збірки: `APP_BUILD_NUMBER` (CI — у Docker-контексті немає `.git`, тому його
 * передають build-arg-ом), інакше кількість комітів `git rev-list --count HEAD`, інакше
 * патч із `package.json`. Нова версія на кожен деплой — бо кожен деплой це новий коміт.
 * Підняти major/minor = змінити `version` у кореневому `package.json`.
 *
 * Історія — `docs/history-summary.md`. Це ДЕМО-ДАНІ: файл підтримується вручну й
 * оновлюється час від часу (docs/build-info.md); скрипт лише розбирає його в структуру.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HistoryEntry {
  label: string;
  value: string;
  children: { label: string; value: string }[];
}

export interface HistoryInfo {
  title: string;
  entries: HistoryEntry[];
}

export interface BuildInfo {
  version: string;
  buildNumber: number;
  commit: string | null;
  builtAt: string;
  history: HistoryInfo | null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `**Label:** value` або `Label: value`; без роздільника — усе йде в label, value порожнє. */
function splitLabel(text: string): { label: string; value: string } {
  const bold = /^\*\*(.+?):?\*\*:?\s*(.*)$/.exec(text);
  if (bold?.[1] !== undefined) return { label: bold[1].trim(), value: (bold[2] ?? '').trim() };
  const at = text.lastIndexOf(': ');
  if (at === -1) return { label: text.trim(), value: '' };
  return { label: text.slice(0, at).trim(), value: text.slice(at + 2).trim() };
}

/**
 * Формат файлу: `# Заголовок`, далі маркери `- **Label:** value`, вкладені (відступ ≥ 2
 * пробіли) — `- label: value`. Усе інше ігнорується; порожній результат = `null`.
 */
export function parseHistory(markdown: string): HistoryInfo | null {
  let title = '';
  const entries: HistoryEntry[] = [];
  for (const line of markdown.split('\n')) {
    const heading = /^#\s+(.+)$/.exec(line);
    if (heading?.[1] !== undefined && title === '') {
      title = heading[1].trim();
      continue;
    }
    const item = /^(\s*)[-*]\s+(.+)$/.exec(line);
    if (item?.[2] === undefined) continue;
    const parsed = splitLabel(item[2]);
    const last = entries.at(-1);
    if ((item[1] ?? '').length >= 2 && last !== undefined) {
      last.children.push(parsed);
    } else {
      entries.push({ ...parsed, children: [] });
    }
  }
  return entries.length === 0 ? null : { title, entries };
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function nonEmpty(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function positiveInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

export function collectBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const [major = '0', minor = '0', patch = '0'] = pkg.version.split('.');
  const buildNumber =
    positiveInt(env.APP_BUILD_NUMBER) ??
    positiveInt(git(['rev-list', '--count', 'HEAD'])) ??
    positiveInt(patch) ??
    0;

  const historyPath = join(ROOT, 'docs', 'history-summary.md');
  return {
    version: `${major}.${minor}.${String(buildNumber)}`,
    buildNumber,
    commit: nonEmpty(env.APP_GIT_SHA) ?? nonEmpty(git(['rev-parse', '--short', 'HEAD'])),
    builtAt: new Date().toISOString(),
    history: existsSync(historyPath) ? parseHistory(readFileSync(historyPath, 'utf8')) : null,
  };
}

if (import.meta.main) {
  process.stdout.write(JSON.stringify(collectBuildInfo()));
}
