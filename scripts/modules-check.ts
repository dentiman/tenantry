/**
 * Перевірка графа модулів (docs/modules.md) проти фактичних імпортів.
 *
 *   pnpm modules:check            звіт: фактичні ребра, порушення, файли без власника; exit 0
 *   pnpm modules:check --strict   те саме, але exit 1 на порушення або файл без власника
 *   pnpm modules:check --edges    лише фактичний граф модуль → модуль (з кількістю імпортів)
 *
 * Чому TypeScript compiler API, а не madge/dependency-cruiser: майже всі імпорти контрактів
 * ідуть через barrel `@saas-skeleton/contracts`, і за шляхом модуля видно лише «залежить від
 * contracts». Тут кожен іменований імпорт резолвиться до файлу, де символ ОГОЛОШЕНО, — тож
 * `import { CalendarEventSchema } from '@saas-skeleton/contracts'` дає ребро до calendar.
 *
 * Межі, які скрипт свідомо не бачить: рядкові звʼязки (i18n-ключі `t('calendar:…')`, шляхи
 * роутів рядком), згенерований orval-клієнт (один файл на всі теги — належить shell) і Prisma
 * relations (див. docs/modules.md, «Прийняті винятки»).
 */
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  COMPOSITION_ROOTS,
  IGNORED,
  MODULES,
  type ModuleDef,
  type ModuleName,
  type Tier,
} from '../modules.config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Кожен tsconfig — окрема програма: у фронтендів і бекендів різні compilerOptions */
const PROGRAMS = [
  'apps/api/tsconfig.json',
  'apps/platform-api/tsconfig.json',
  'apps/worker/tsconfig.json',
  'apps/web/tsconfig.json',
  'apps/platform-web/tsconfig.json',
  'libs/contracts/tsconfig.json',
  'libs/shared/tsconfig.json',
  'libs/database/tsconfig.json',
  'libs/ui/tsconfig.json',
  'libs/i18n/tsconfig.json',
];

type Owner = { kind: 'module'; name: ModuleName } | { kind: 'root' } | { kind: 'ignored' };

interface Violation {
  from: ModuleName;
  to: ModuleName;
  file: string;
  line: number;
  target: string;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** `*` — будь-що в межах одного сегмента шляху; шаблон на `/` — уся тека */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(pattern.endsWith('/') ? `^${escaped}` : `^${escaped}$`);
}

const IGNORED_RE = IGNORED.map(patternToRegExp);
const TEST_OR_DECL_RE = /\.(test|spec|e2e-spec)\.tsx?$|\.d\.ts$/;
const ROOT_RE = COMPOSITION_ROOTS.map(patternToRegExp);
// Найконкретніший шаблон перемагає: `apps/web/src/pages/settings/calendar.tsx` у calendar
// важить більше за `apps/web/src/pages/settings/` у settings
const OWNERSHIP = Object.entries(MODULES)
  .flatMap(([name, def]) =>
    def.paths.map((pattern) => ({
      name: name as ModuleName,
      pattern,
      re: patternToRegExp(pattern),
    })),
  )
  .sort((a, b) => b.pattern.length - a.pattern.length);

const ownerCache = new Map<string, Owner | null>();

/** null — файл репозиторію, якого не покриває жоден шаблон (треба додати в modules.config.ts) */
function ownerOf(relPath: string): Owner | null {
  const cached = ownerCache.get(relPath);
  if (cached !== undefined) return cached;
  let owner: Owner | null = null;
  if (TEST_OR_DECL_RE.test(relPath) || IGNORED_RE.some((re) => re.test(relPath))) {
    owner = { kind: 'ignored' };
  } else if (ROOT_RE.some((re) => re.test(relPath))) owner = { kind: 'root' };
  else {
    const hit = OWNERSHIP.find((entry) => entry.re.test(relPath));
    if (hit) owner = { kind: 'module', name: hit.name };
  }
  ownerCache.set(relPath, owner);
  return owner;
}

function repoPath(fileName: string): string | null {
  const rel = toPosix(relative(ROOT, fileName));
  if (rel.startsWith('..') || rel.includes('node_modules/')) return null;
  return rel;
}

function loadProgram(tsconfig: string): ts.Program {
  const configPath = join(ROOT, tsconfig);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error(`Не вдалося прочитати ${tsconfig}`);
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
}

/** Файли, у яких оголошено символи, що імпортує цей вузол (або сам модуль, якщо символів немає) */
function importTargets(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
  source: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
): string[] {
  const targets = new Set<string>();
  const addSymbol = (name: ts.Node): void => {
    let symbol = checker.getSymbolAtLocation(name);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const decl of symbol?.declarations ?? []) targets.add(decl.getSourceFile().fileName);
  };

  // Лише іменовані імпорти/реекспорти резолвимо до оголошення символу; default, namespace,
  // side-effect і `export *` дають ребро до самого модуля, на який вказує специфікатор
  let isOnlyNamed = false;
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) addSymbol(el.name);
      isOnlyNamed = !clause.name;
    }
  } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) addSymbol(el.name);
    isOnlyNamed = true;
  }

  if (!isOnlyNamed && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    const resolved = ts.resolveModuleName(
      node.moduleSpecifier.text,
      source.fileName,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
    if (resolved) targets.add(resolved.resolvedFileName);
  }
  return [...targets];
}

function main(): number {
  const args = new Set(process.argv.slice(2));
  const strict = args.has('--strict');
  const edgesOnly = args.has('--edges');

  const seen = new Set<string>();
  const edgeCounts = new Map<string, number>();
  const violations: Violation[] = [];
  const unowned = new Set<string>();

  for (const tsconfig of PROGRAMS) {
    const program = loadProgram(tsconfig);
    const checker = program.getTypeChecker();
    for (const source of program.getSourceFiles()) {
      const fromPath = repoPath(source.fileName);
      if (!fromPath || seen.has(fromPath)) continue;
      seen.add(fromPath);
      const fromOwner = ownerOf(fromPath);
      if (!fromOwner) {
        unowned.add(fromPath);
        continue;
      }
      if (fromOwner.kind !== 'module') continue;
      const from = fromOwner.name;

      for (const stmt of source.statements) {
        if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt)) continue;
        if (!stmt.moduleSpecifier) continue;
        for (const targetFile of importTargets(stmt, source, program, checker)) {
          const toPath = repoPath(targetFile);
          if (!toPath) continue;
          const toOwner = ownerOf(toPath);
          if (!toOwner) {
            unowned.add(toPath);
            continue;
          }
          if (toOwner.kind !== 'module' || toOwner.name === from) continue;
          const to = toOwner.name;
          const key = `${from} → ${to}`;
          edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
          // infra не має домену — на нього можна спиратися без декларації
          if (
            MODULES[to].tier !== 'infra' &&
            !(MODULES[from].dependsOn as readonly string[]).includes(to)
          ) {
            const { line } = source.getLineAndCharacterOfPosition(stmt.getStart(source));
            violations.push({ from, to, file: fromPath, line: line + 1, target: toPath });
          }
        }
      }
    }
  }

  if (edgesOnly) {
    for (const [edge, count] of [...edgeCounts].sort()) console.log(`${edge}  (${String(count)})`);
    return 0;
  }

  const byEdge = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = `${v.from} → ${v.to}`;
    byEdge.set(key, [...(byEdge.get(key) ?? []), v]);
  }
  if (byEdge.size === 0) console.log('Порушень графа модулів немає.');
  else {
    console.log(
      `Порушення графа модулів: ${String(violations.length)} імпортів, ${String(byEdge.size)} ребер\n`,
    );
    for (const [edge, list] of [...byEdge].sort()) {
      const [first] = list;
      if (first) console.log(`${edge}  (${MODULES[first.from].tier} → ${MODULES[first.to].tier})`);
      const unique = new Map(list.map((v) => [`${v.file}:${String(v.line)}`, v]));
      for (const [at, v] of unique) console.log(`    ${at}  →  ${v.target}`);
    }
  }
  if (unowned.size > 0) {
    console.log(`\nФайли без модуля (додай шаблон у modules.config.ts): ${String(unowned.size)}`);
    for (const file of [...unowned].sort()) console.log(`    ${file}`);
  }
  // Застарілі ребра — задекларовані, але не використані: граф має описувати код, а не бажання
  const unused: string[] = [];
  for (const [name, def] of Object.entries(MODULES)) {
    for (const dep of def.dependsOn) {
      if (!edgeCounts.has(`${name} → ${dep}`)) unused.push(`${name} → ${dep}`);
    }
  }
  if (unused.length > 0) {
    console.log(
      `\nЗадекларовані ребра без жодного імпорту (прибери або поясни): ${String(unused.length)}`,
    );
    for (const edge of unused.sort()) console.log(`    ${edge}`);
  }

  return strict && (violations.length > 0 || unowned.size > 0) ? 1 : 0;
}

const TIER_RANK: Record<Tier, number> = { infra: 0, platform: 1, core: 2, feature: 3 };

/**
 * Перевірка самої декларації, ще до коду: невідомі модулі, ребро вгору по рівнях і цикли.
 * Цикли всередині platform терпимо — це ядро, яке ніхто не видаляє частинами
 * (auth ↔ realtime, notifications ↔ realtime, users ↔ account); див. docs/modules.md §2.
 */
function validateDeclaration(): string[] {
  const errors: string[] = [];
  const modules = MODULES as Record<string, ModuleDef>;
  for (const [name, def] of Object.entries(modules)) {
    for (const dep of def.dependsOn) {
      const target = modules[dep];
      if (!target) {
        errors.push(`${name}.dependsOn: невідомий модуль "${dep}"`);
        continue;
      }
      if (target.tier === 'infra')
        errors.push(`${name}.dependsOn: infra дозволений неявно, прибери "${dep}"`);
      if (TIER_RANK[target.tier] > TIER_RANK[def.tier]) {
        errors.push(
          `${name} (${def.tier}) → ${dep} (${target.tier}): ребро вгору по рівнях — це слот, а не залежність`,
        );
      }
    }
  }
  const cycleEdges = (from: string): string[] =>
    (modules[from]?.dependsOn ?? []).filter(
      (to) => !(modules[from]?.tier === 'platform' && modules[to]?.tier === 'platform'),
    );
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string, path: string[]): void => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      errors.push(`цикл: ${[...path.slice(path.indexOf(node)), node].join(' → ')}`);
      return;
    }
    state.set(node, 'visiting');
    for (const next of cycleEdges(node)) visit(next, [...path, node]);
    state.set(node, 'done');
  };
  for (const name of Object.keys(modules)) visit(name, []);
  return errors;
}

const declarationErrors = validateDeclaration();
if (declarationErrors.length > 0) {
  console.error('modules.config.ts суперечить сам собі:');
  for (const e of declarationErrors) console.error(`    ${e}`);
  process.exitCode = 1;
} else {
  process.exitCode = main();
}
