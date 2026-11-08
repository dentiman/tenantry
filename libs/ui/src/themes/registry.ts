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
export type UiThemeId = 'tenantry' | 'gray';

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
const TENANTRY_THEME: UiTheme = {
  id: 'tenantry',
  labelKey: 'theme.palettes.tenantry',
  swatch: [
    'oklch(0.984 0.003 247.858)',
    'oklch(0.929 0.013 255.508)',
    'oklch(0.546 0.245 262.881)',
  ],
};

/**
 * Палітра Notion: теплі zinc-нейтралі у світлі, темний Notion у темряві. Була
 * дефолтною до 2026-11-08.
 */
const GRAY_THEME: UiTheme = {
  id: 'gray',
  labelKey: 'theme.palettes.gray',
  swatch: ['oklch(0.9702 0 0)', 'oklch(0.9 0.004 286.32)', 'oklch(0.6204 0.195 253.83)'],
};

/** Порядок = порядок пунктів у меню вибору */
export const UI_THEMES: readonly UiTheme[] = [TENANTRY_THEME, GRAY_THEME];

export const DEFAULT_UI_THEME: UiThemeId = TENANTRY_THEME.id;

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
  return UI_THEMES.find((theme) => theme.id === id) ?? TENANTRY_THEME;
}
