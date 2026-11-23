/**
 * ДЖЕРЕЛО фактури картки «кубики» — генератор плитки `libs/ui/src/assets/cube-tile.svg`.
 *
 *   pnpm ui:cube-tile            перегенерувати плитку з параметрами нижче
 *   pnpm ui:cube-tile --check    звірити закомічений файл із генератором (нічого не пише)
 *
 * Це ВИХІДНИК, а не код застосунку: він лежить у `scripts/`, жоден фронтенд його не
 * імпортує, і в бандл він не потрапляє. У бандл іде лише результат — статичний SVG, який
 * `card-surface.css` підключає як `mask-image` (`<Card texture="cubes">`). Малюнок розвиваємо
 * ТУТ (сітка, набір форм, шов, ступені тону), потім запускаємо скрипт і комітимо SVG разом
 * зі скриптом. Руками SVG не правити.
 *
 * Що саме малюється: суцільна «кладка» на сітці `CELL` — квадрати 1–3 клітинки і «склеєні»
 * кубики, витягнуті по X або по Y. Фігури стикуються без дірок і без накладань (накладання
 * напівпрозорих фігур давало яскраві плями) і не перетинають край плитки, тому плитка
 * безшовна. Сусіди різняться тоном (`VARIANCE`, `LEVELS` ступенів) — це альфа маски; колір і
 * загальну прозорість задає CSS.
 *
 * Чому файл, а не генерація в браузері (рішення 2026-11-19): перша версія малювала кожен
 * кубик окремим `<rect>` у DOM — десятки тисяч вузлів на сторінку, інтерфейс гальмував.
 * Плитка-маска — нуль вузлів і нуль JS, браузер кешує її як звичайну картинку.
 *
 * Змінив `CELL` або `TILE_CELLS` — онови `mask-size` у `card-surface.css` (сторона плитки =
 * `CELL × TILE_CELLS` px), інакше кубики масштабуються.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Крок сітки, px — масштаб кубиків */
const CELL = 4;
/** Сторона плитки в клітинках (256px при CELL = 4) */
const TILE_CELLS = 64;
/** Шов між кубиками, px: маса майже суцільна, але межі читаються */
const GAP = 0.6;
/** Наскільки сусіди різняться тоном (частка альфи) */
const VARIANCE = 0.3;
/** Скільки ступенів тону: один `<path>` на ступінь замість атрибута на кубик */
const LEVELS = 6;
/** Зерно розкладки: той самий seed дає той самий файл байт у байт */
const SEED = 7;

type Span = readonly [x: number, y: number];

/** Набір форм і їхні частки. Перша — запасна: одна клітинка влазить завжди */
const FORMS: readonly [{ share: number; span: Span }, ...{ share: number; span: Span }[]] = [
  { share: 0.4, span: [1, 1] },
  { share: 0.11, span: [2, 1] },
  { share: 0.11, span: [1, 2] },
  { share: 0.07, span: [3, 1] },
  { share: 0.07, span: [1, 3] },
  { share: 0.12, span: [2, 2] },
  { share: 0.04, span: [3, 2] },
  { share: 0.04, span: [2, 3] },
  { share: 0.04, span: [3, 3] },
];

const OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'libs',
  'ui',
  'src',
  'assets',
  'cube-tile.svg',
);

function buildTile(): string {
  const random = mulberry32(SEED);
  const side = TILE_CELLS * CELL;
  const taken = new Set<string>();
  const paths = Array.from({ length: LEVELS }, () => '');

  for (let row = 0; row < TILE_CELLS; row += 1) {
    for (let col = 0; col < TILE_CELLS; col += 1) {
      // Обидва `random()` викликаються безумовно: послідовність не має залежати від того,
      // зайнята клітинка чи ні
      const formRoll = random();
      const shade = random();

      if (taken.has(`${String(col)}:${String(row)}`)) continue;

      const wanted = pickForm(formRoll);
      const [spanX, spanY] = fits(taken, col, row, wanted) ? wanted : FORMS[0].span;
      for (let y = 0; y < spanY; y += 1) {
        for (let x = 0; x < spanX; x += 1) {
          taken.add(`${String(col + x)}:${String(row + y)}`);
        }
      }

      const x = (col * CELL + GAP / 2).toFixed(1);
      const y = (row * CELL + GAP / 2).toFixed(1);
      const w = (spanX * CELL - GAP).toFixed(1);
      const h = (spanY * CELL - GAP).toFixed(1);
      const level = Math.min(LEVELS - 1, Math.floor(shade * LEVELS));
      paths[level] = `${paths[level] ?? ''}M${x} ${y}h${w}v${h}h-${w}z`;
    }
  }

  const body = paths
    .map((d, level) => {
      const alpha = (1 - (VARIANCE * level) / (LEVELS - 1)).toFixed(2);
      return `<path fill-opacity="${alpha}" d="${d}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(side)}" height="${String(side)}">${body}</svg>\n`;
}

function pickForm(roll: number): Span {
  let left = roll;
  for (const form of FORMS) {
    if (left < form.share) return form.span;
    left -= form.share;
  }
  return FORMS[0].span;
}

function fits(taken: Set<string>, col: number, row: number, [spanX, spanY]: Span): boolean {
  // Блок не виходить за край плитки — інакше на стику плиток був би шов
  if (col + spanX > TILE_CELLS || row + spanY > TILE_CELLS) return false;
  for (let y = 0; y < spanY; y += 1) {
    for (let x = 0; x < spanX; x += 1) {
      if (taken.has(`${String(col + x)}:${String(row + y)}`)) return false;
    }
  }
  return true;
}

/** Малий детермінований ГВЧ — `Math.random` давав би новий файл на кожен запуск */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tile = buildTile();

if (process.argv.includes('--check')) {
  const committed = readFileSync(OUTPUT, 'utf8');
  if (committed !== tile) {
    console.error('cube-tile.svg не збігається з генератором — запусти `pnpm ui:cube-tile`');
    process.exit(1);
  }
  console.log('cube-tile.svg — актуальний');
} else {
  writeFileSync(OUTPUT, tile);
  console.log(`cube-tile.svg — ${String(tile.length)} байт, ${String(TILE_CELLS * CELL)}px`);
}
