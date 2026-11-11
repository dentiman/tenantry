/**
 * Бюджет стартового завантаження фронтендів (docs/frontend/lazy-loading.md §5).
 *
 *   pnpm bundle:check            збирає обидва фронти у тимчасову теку й звіряє з бюджетом
 *   pnpm bundle:check --report   те саме, але виводить ще й таблицю найбільших чанків
 *
 * Що саме перевіряється — двома дешевими способами, без хрупких евристик:
 * 1. РОЗМІР стартового набору: entry-чанк `index.html` + усе, що він імпортує статично
 *    (manifest Vite: `imports` транзитивно). Це те, що браузер качає до першого рендера, а
 *    ледачі чанки сюди не входять. Порівнюємо gzip-розмір JS із BUDGETS.
 * 2. СТРУКТУРА: жодна сторінка `features/<модуль>/pages/*.tsx` не має бути у стартових чанках.
 *    Дивимось у sourcemap цих чанків (`sources`) — це фактичний склад, а не здогад за
 *    імпортами. Статичний `import { XPage } from './pages/x'` у composition root зливає сторінку
 *    в entry, і вона зʼявиться тут. Виняток — `eagerPages` (з обґрунтуванням). ESLint ловить те
 *    саме на етапі `pnpm lint`; тут — страховка за фактичним результатом збірки.
 *
 * Бюджет піднімається свідомо, окремим рядком у цьому файлі разом із поясненням у коміті, а не
 * «щоб пройшло». Поточні значення — виміряні 2026-11-11 + ~10% запасу.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface AppBudget {
  /** Папка апки в `apps/` і імʼя пакета pnpm */
  readonly dir: string;
  readonly pkg: string;
  /** Стеля gzip-розміру всього JS стартового набору, КБ */
  readonly initialJsGzipKb: number;
  /** Сторінки, яким свідомо дозволено жити в стартовому наборі (шлях відносно `src/`) */
  readonly eagerPages: readonly string[];
}

const BUDGETS: readonly AppBudget[] = [
  {
    dir: 'web',
    pkg: '@saas-skeleton/web',
    initialJsGzipKb: 400, // виміряно 365 (було 600 до ледачих маршрутів)
    // Вхід для гостя: перший екран кожного неавторизованого візиту, окремий чанк = зайвий RTT
    eagerPages: ['features/auth/pages/login.tsx'],
  },
  {
    dir: 'platform-web',
    pkg: '@saas-skeleton/platform-web',
    initialJsGzipKb: 335, // виміряно 304 (було 384)
    eagerPages: ['features/auth/pages/login.tsx'],
  },
];

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  css?: string[];
}

const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function sizes(path: string): { raw: number; gzip: number } {
  const buffer = readFileSync(path);
  return { raw: buffer.length, gzip: gzipSync(buffer).length };
}

function build(app: AppBudget, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync(
    'pnpm',
    [
      '--filter',
      app.pkg,
      'exec',
      'vite',
      'build',
      '--logLevel',
      'error',
      '--manifest',
      '--sourcemap',
      '--outDir',
      outDir,
      '--emptyOutDir',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

interface StartSet {
  readonly jsFiles: string[];
  readonly js: { raw: number; gzip: number };
  readonly cssGzip: number;
}

/** Стартовий набір = транзитивне замикання статичних імпортів entry */
function measureStartSet(
  appName: string,
  manifest: Record<string, ManifestChunk>,
  outDir: string,
): StartSet {
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  if (!entryKey) throw new Error(`${appName}: у manifest немає entry`);
  const initial = new Set<string>();
  const walk = (key: string): void => {
    if (initial.has(key)) return;
    initial.add(key);
    for (const next of manifest[key]?.imports ?? []) walk(next);
  };
  walk(entryKey);

  const chunks = [...initial].flatMap((key) => {
    const chunk = manifest[key];
    return chunk ? [chunk] : [];
  });
  const jsFiles = chunks.map((chunk) => chunk.file);
  const js = jsFiles.reduce(
    (sum, file) => {
      const s = sizes(join(outDir, file));
      return { raw: sum.raw + s.raw, gzip: sum.gzip + s.gzip };
    },
    { raw: 0, gzip: 0 },
  );
  const cssGzip = chunks
    .flatMap((chunk) => chunk.css ?? [])
    .reduce((sum, file) => sum + sizes(join(outDir, file)).gzip, 0);
  return { jsFiles, js, cssGzip };
}

function printSummary(app: AppBudget, outDir: string, start: StartSet, showReport: boolean): void {
  const allJs = listFiles(outDir).filter((file) => file.endsWith('.js'));
  const totalJsRaw = allJs.reduce((sum, file) => sum + statSync(file).size, 0);

  console.log(`\n${app.dir}`);
  console.log(
    `  стартовий JS:  ${kb(start.js.raw)} КБ raw / ${kb(start.js.gzip)} КБ gzip  (${String(start.jsFiles.length)} файлів; бюджет ${String(app.initialJsGzipKb)} КБ gzip)`,
  );
  console.log(`  стартовий CSS: ${kb(start.cssGzip)} КБ gzip`);
  console.log(`  усього JS:     ${kb(totalJsRaw)} КБ raw у ${String(allJs.length)} чанках`);

  if (!showReport) return;
  const rows = allJs
    .map((file) => ({
      file: relative(outDir, file),
      ...sizes(file),
      initial: start.jsFiles.includes(relative(outDir, file)),
    }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 15);
  for (const row of rows) {
    console.log(
      `    ${kb(row.raw).padStart(8)} КБ  ${kb(row.gzip).padStart(7)} gzip  ${row.initial ? '[старт]' : '       '} ${row.file}`,
    );
  }
}

/** Структура: у стартових чанках немає сторінок модулів (за `sources` їхніх sourcemap) */
function findEagerPages(app: AppBudget, outDir: string, jsFiles: readonly string[]): string[] {
  const pagePattern = /\/src\/features\/[^/]+\/pages\/[^/]+\.tsx$/;
  const problems: string[] = [];
  for (const file of jsFiles) {
    const map = JSON.parse(readFileSync(join(outDir, `${file}.map`), 'utf8')) as {
      sources: string[];
    };
    for (const source of map.sources) {
      if (!pagePattern.test(source)) continue;
      const page = source.slice(source.indexOf('features/'));
      if (app.eagerPages.includes(page)) continue;
      problems.push(
        `${app.dir}: ${page} потрапила в стартовий чанк ${file} — її імпортують статично (composition root або інший eager-модуль). Маршрут оголошується через lazyPage(() => import('./pages/…'), 'Назва'); див. docs/frontend/lazy-loading.md.`,
      );
    }
  }
  return problems;
}

function check(app: AppBudget, showReport: boolean): string[] {
  const outName = 'dist-bundle-check';
  const outDir = join(ROOT, 'apps', app.dir, outName);
  try {
    build(app, outName);
    const manifest = JSON.parse(
      readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'),
    ) as Record<string, ManifestChunk>;
    const start = measureStartSet(app.dir, manifest, outDir);
    printSummary(app, outDir, start, showReport);

    const problems: string[] = [];
    if (start.js.gzip > app.initialJsGzipKb * 1024) {
      problems.push(
        `${app.dir}: стартовий JS ${kb(start.js.gzip)} КБ gzip > бюджету ${String(app.initialJsGzipKb)} КБ. Перевір, що нова сторінка/важка бібліотека не потрапила в composition root (router.tsx, slot-fills.ts, *.nav.ts, main.tsx); --report покаже найбільші чанки.`,
      );
    }
    return [...problems, ...findEagerPages(app, outDir, start.jsFiles)];
  } finally {
    // Тимчасова тека не лишається і при падінні збірки
    rmSync(outDir, { recursive: true, force: true });
  }
}

const showReport = process.argv.includes('--report');
const problems = BUDGETS.flatMap((app) => check(app, showReport));

if (problems.length > 0) {
  console.error(`\nbundle:check — порушень: ${String(problems.length)}`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('\nbundle:check — у межах бюджету');
