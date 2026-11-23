import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_THEME, UI_THEMES } from './registry';

/**
 * Контракт тем (`docs/frontend/theming.md` §2, §5).
 *
 * Додати тему — це CSS-файл плюс правки в шести місцях, і жодне з них не ловить ні
 * `tsc`, ні lint: забутий рядок у `index.html` дає спалах дефолтної теми, забутий
 * ключ локалі — сирий ключ у меню, забутий токен у темі мовчки береться зі світлого
 * режиму або з бази. Цей тест читає всі шість місць і звіряє їх із реєстром
 * (`registry.ts`) — єдиним переліком палітр.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

const THEMES_DIR = HERE;
const STYLES_CSS = resolve(HERE, '../styles.css');
const INDEX_HTML = [
  resolve(REPO, 'apps/web/index.html'),
  resolve(REPO, 'apps/platform-web/index.html'),
];
const LAYOUT_JSON = [
  resolve(REPO, 'apps/web/src/locales/en/layout.json'),
  resolve(REPO, 'apps/platform-web/src/locales/en/layout.json'),
];

const IDS = UI_THEMES.map((theme) => theme.id);

/**
 * Токени, яких світлий режим може не мати: `--radius` не залежить від режиму, тому
 * живе лише в світлому блоці.
 */
const MODE_INDEPENDENT = new Set(['--radius']);

/**
 * Проміжні токени, які тема вводить САМА для власних потреб (`--tone-*` у темряві
 * `tenantry`: чотири тони, на які посилаються поверхні того ж блоку). Назовні вони
 * не контракт, тож відсутність у світлому блоці — не помилка.
 */
const THEME_INTERNAL_PREFIX = '--tone-';

const read = (path: string): string => readFileSync(path, 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Block {
  selector: string;
  tokens: Set<string>;
}

/** Плоский розбір: у файлах тем і в `:root`/`.dark` бази немає вкладених at-правил */
function parseBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector = '', body = ''] = match;
    const tokens = new Set([...body.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1] ?? ''));
    // Перед першим блоком файла можуть стояти `@import …;` — селектор це те, що після останньої «;»
    const bare = selector.slice(selector.lastIndexOf(';') + 1);
    blocks.push({ selector: bare.trim().replace(/\s+/g, ' '), tokens });
  }
  return blocks;
}

function themeBlocks(id: string): { light: Block; dark: Block } {
  const blocks = parseBlocks(read(resolve(THEMES_DIR, `${id}.css`)));
  const dark = blocks.filter((block) => block.selector.endsWith('.dark'));
  const light = blocks.filter((block) => !block.selector.endsWith('.dark'));
  // Рівно два блоки: світлий і темний. Третій (медіа-запит, перекриття) означав би
  // токени, яких цей тест не бачить
  expect(blocks, `themes/${id}.css: очікується рівно два блоки (світло + темрява)`).toHaveLength(2);
  const [lightBlock] = light;
  const [darkBlock] = dark;
  if (!lightBlock || !darkBlock) {
    throw new Error(`themes/${id}.css: потрібні один світлий і один темний блок`);
  }
  return { light: lightBlock, dark: darkBlock };
}

/** Токени бази (`styles.css`): `:root` і `.dark`, які теми перевизначають вибірково */
function baseTokens(): Set<string> {
  const blocks = parseBlocks(read(STYLES_CSS)).filter(
    (block) => block.selector === ':root' || block.selector === '.dark',
  );
  return new Set(blocks.flatMap((block) => [...block.tokens]));
}

const diff = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x)).sort();

describe('реєстр тем ↔ файли', () => {
  it('кожна тема реєстру має власний файл, і кожен файл теми є в реєстрі', () => {
    const files = readdirSync(THEMES_DIR)
      .filter((name) => name.endsWith('.css'))
      .map((name) => name.replace(/\.css$/, ''))
      .sort();
    expect(files).toEqual([...IDS].sort());
  });

  it('styles.css підключає рівно ті теми, що є в реєстрі', () => {
    const imported = [...read(STYLES_CSS).matchAll(/@import\s+'\.\/themes\/([\w-]+)\.css'/g)]
      .map((m) => m[1])
      .sort();
    expect(imported).toEqual([...IDS].sort());
  });

  it('id теми, її labelKey і селектори файла збігаються', () => {
    for (const theme of UI_THEMES) {
      expect(theme.labelKey).toBe(`theme.palettes.${theme.id}`);
      const { light, dark } = themeBlocks(theme.id);
      expect(light.selector).toContain(`:root[data-theme='${theme.id}']`);
      expect(dark.selector).toContain(`:root[data-theme='${theme.id}'].dark`);
    }
  });

  it('лише дефолтна тема має селектор `:root:not([data-theme])`', () => {
    for (const theme of UI_THEMES) {
      const { light, dark } = themeBlocks(theme.id);
      const isDefault = theme.id === DEFAULT_UI_THEME;
      expect(light.selector.includes(':root:not([data-theme])')).toBe(isDefault);
      expect(dark.selector.includes(':root:not([data-theme]).dark')).toBe(isDefault);
    }
  });
});

describe('повнота наборів токенів', () => {
  const reference = themeBlocks(DEFAULT_UI_THEME);
  const base = baseTokens();

  it('еталон не порожній — інакше решта перевірок нічого не доводить', () => {
    expect(reference.light.tokens.size).toBeGreaterThan(40);
  });

  for (const theme of UI_THEMES) {
    describe(`тема ${theme.id}`, () => {
      const { light, dark } = themeBlocks(theme.id);

      it('світлий блок оголошує той самий набір токенів, що й дефолтна тема', () => {
        expect(diff(reference.light.tokens, light.tokens), 'бракує токенів').toEqual([]);
        expect(diff(light.tokens, reference.light.tokens), 'зайві токени (описка?)').toEqual([]);
      });

      it('темний блок оголошує все, що світлий (крім незалежного від режиму)', () => {
        const missing = diff(light.tokens, dark.tokens).filter((t) => !MODE_INDEPENDENT.has(t));
        // Забутий токен у темряві мовчки береться зі світлого блоку
        expect(missing).toEqual([]);
      });

      it('усе, чого немає у світлому блоці, — перевизначення бази або внутрішній токен теми', () => {
        const unknown = diff(dark.tokens, light.tokens).filter(
          (t) => !base.has(t) && !t.startsWith(THEME_INTERNAL_PREFIX),
        );
        expect(unknown).toEqual([]);
      });

      it('не оголошує токени спільної палітри подій (`--event-*`)', () => {
        const events = [...light.tokens, ...dark.tokens].filter((t) => t.startsWith('--event-'));
        expect(events).toEqual([]);
      });
    });
  }
});

describe('споживачі списку палітр', () => {
  for (const path of INDEX_HTML) {
    const label = path.replace(`${REPO}/`, '');

    it(`${label}: блокувальний скрипт знає рівно ті палітри, що є в реєстрі`, () => {
      const match = /\[([^\]]*)\]\.indexOf\(palette\)/.exec(read(path));
      expect(match, 'не знайдено список палітр у блокувальному скрипті').not.toBeNull();
      const listed = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
      expect(listed).toEqual([...IDS].sort());
    });
  }

  for (const path of LAYOUT_JSON) {
    const label = path.replace(`${REPO}/`, '');

    it(`${label}: є ключі theme.palettes.<id> для кожної теми і немає зайвих`, () => {
      const layout = JSON.parse(read(path)) as { theme?: { palettes?: Record<string, unknown> } };
      const palettes = layout.theme?.palettes ?? {};
      expect(Object.keys(palettes).sort()).toEqual([...IDS].sort());
      for (const id of IDS) {
        expect(typeof palettes[id], `theme.palettes.${id} — не рядок`).toBe('string');
      }
    });
  }
});
