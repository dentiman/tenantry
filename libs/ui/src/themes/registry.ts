/**
 * Реєстр тем — ЄДИНЕ місце, де видно повний список палітр.
 *
 * Тема = набір значень токенів; сама вона живе у власному CSS-файлі
 * (`./<id>.css`, селектори `:root[data-theme='<id>']` і `….dark`), а тут
 * оголошено лише те, що потрібно інтерфейсу вибору. Дефолтна тема файлом не
 * відрізняється — вона лише додає собі пару `:root:not([data-theme])`, щоб
 * сторінка була розфарбована ще до того, як JS виставить атрибут. Тобто
 * «яка тема дефолтна» — це рядок `DEFAULT_UI_THEME` нижче, а не місце в CSS.
 *
 * Додати тему = файл CSS + `@import` у `styles.css` + рядок тут.
 * Контракт і план — `docs/frontend/theming.md`.
 */
export type UiThemeId = 'default' | 'slate' | 'graphite';

export interface UiTheme {
  id: UiThemeId;
  /** Ключ у namespace `layout`: тексту в коді немає (i18n-доктрина) */
  labelKey: string;
  /**
   * Превʼю в меню — полотно, межа, primary. Саме ці три ролі й відрізняють
   * теми між собою; беруться зі світлого режиму, бо меню найчастіше бачать саме в ньому.
   */
  swatch: readonly [string, string, string];
}

/**
 * Дефолт продукту. Світло — холодна шкала slate з акцентом blue-600, темрява —
 * палітра інтерфейсу Orca (`themes/tenantry.css`). Дзеркалом одне одному
 * режими не є навмисно: спільним лишається контракт ролей, а не палітра.
 */
const SLATE_THEME: UiTheme = {
  id: 'slate',
  labelKey: 'theme.palettes.slate',
  swatch: [
    'oklch(0.984 0.003 247.858)',
    'oklch(0.929 0.013 255.508)',
    'oklch(0.546 0.245 262.881)',
  ],
};

/**
 * Палітра Notion: теплі zinc-нейтралі у світлі, глибокий темний Notion (#191919)
 * у темряві. Була дефолтною до 2026-11-08 як `gray`; перейменована 2026-11-12.
 */
const GRAPHITE_THEME: UiTheme = {
  id: 'graphite',
  labelKey: 'theme.palettes.graphite',
  swatch: ['oklch(0.9702 0 0)', 'oklch(0.9 0.004 286.32)', 'oklch(0.6204 0.195 253.83)'],
};

/**
 * «Стандартна» будова поверхонь без інверсій: полотно — найглибше, шел, бічні
 * панелі, картки й діалог на одній сходинці над ним в обох режимах, у темряві
 * «вище = світліше» (Notion/M3/Atlassian). Нейтралі майже без хроми. Додана
 * 2026-11-12 як еталон для §3.3 theming.md. Акценти (primary/secondary/danger)
 * — Atlassian Design System (Jira), у темряві bold-кнопка інвертована: світла
 * заливка, темний текст.
 */
const DEFAULT_THEME: UiTheme = {
  id: 'default',
  labelKey: 'theme.palettes.default',
  swatch: ['oklch(0.97 0.003 265)', 'oklch(0.905 0.005 265)', '#1868db'],
};

/** Порядок = порядок пунктів у меню вибору */
export const UI_THEMES: readonly UiTheme[] = [DEFAULT_THEME, SLATE_THEME, GRAPHITE_THEME];

export const DEFAULT_UI_THEME: UiThemeId = DEFAULT_THEME.id;

/**
 * Валідація на КОЖНОМУ читанні ззовні (localStorage, атрибут): id теми може
 * зникнути з реєстру після перейменування, і тоді збережене значення лишило б
 * користувача з мертвим атрибутом і напівзастосованою темою.
 */
export function isUiThemeId(value: unknown): value is UiThemeId {
  return typeof value === 'string' && UI_THEMES.some((theme) => theme.id === value);
}

/** Тема за id з гарантованим фолбеком — щоб виклик не тягнув перевірку на undefined */
export function getUiTheme(id: UiThemeId): UiTheme {
  return UI_THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}
