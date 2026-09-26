import type { ReactNode } from 'react';

export type SortOrder = 'asc' | 'desc';

/**
 * Опис сортування в термінах UI (колонка + напрям). Раніше цей тип приходив із React Aria
 * (реекспорт старої UI-бібліотеки); shadcn-таблиця — чиста розмітка без власної моделі сортування,
 * тож тип став наш. Форма публічного контракту `DataGridNavigation` не змінилась, зате
 * `column` тепер `string`, а не React-Aria-івський `Key` (звідси зник каст у `sort.ts`).
 */
export interface SortDescriptor {
  column: string;
  direction: 'ascending' | 'descending';
}

/**
 * Мінімальна форма фільтрів гріда: page/sortBy/sortOrder/search — решта полів
 * (доменні фільтри) — довільні, специфічні для сторінки. «Фільтри» тут у широкому
 * сенсі — усе, що звужує/упорядковує список, включно з пагінацією і сортуванням.
 * Той самий тип, що й route-схема сторінки (search params TanStack Router — це
 * URL query, не текстовий пошук), якщо грід синхронізується з URL.
 */
export interface DataGridFiltersBase {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

/** Дефолт розміру сторінки — синхронізований із бекендом (PaginationQuerySchema, 20) */
export const DEFAULT_PAGE_LIMIT = 20;

/** Дефолтні варіанти для селекта «Items per page» у футері гріда */
export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100, 200];

/** Те, що DataGrid реально читає з grid-стану — не залежить від конкретного TSearch */
export interface DataGridNavigation {
  page: number;
  limit: number;
  sortDescriptor: SortDescriptor | undefined;
  onSortChange: (descriptor: SortDescriptor) => void;
  goToPage: (page: number) => void;
  /** Зміна розміру сторінки скидає page; дефолтне значення зникає з URL */
  setLimit: (limit: number) => void;
}

export interface DataGridColumn<T> {
  /**
   * Ідентифікатор колонки; для sortable-колонок = значення sortBy в API.
   * Також ключ збереженого вибору полів (localStorage) — перейменування id
   * повертає цьому полю дефолтну видимість (не ламає, але «забуває»)
   */
  id: string;
  /** Підпис у хедері таблиці — і той самий підпис у меню полів */
  header: string;
  cell: (item: T) => ReactNode;
  sortable?: boolean;
  isRowHeader?: boolean;
  align?: 'start' | 'end';
  className?: string;
  /** false — поле не можна сховати (завжди видиме, у меню полів його немає). Дефолт true */
  hideable?: boolean;
  /** Сховане, доки його не ввімкне набір полів або користувач */
  defaultHidden?: boolean;
  /**
   * false — поле закріплене на початку (у порядку декларації серед закріплених):
   * без ручки в меню, заголовок не тягнеться, перед ним нічого не вставити.
   * Аналог primary field в Airtable. Дефолт true
   */
  reorderable?: boolean;
}

/**
 * Поле запису — атрибут, який грід показує. Таблиця рендерить поле колонкою, майбутні
 * картки — рядком картки; тому на рівні `Grid.Root` це `fields`, а не `columns`.
 * Поки що форма та сама, що в колонки (табличні опції align/className/isRowHeader
 * переїдуть у `table: {…}`, коли зʼявиться другий рендерер).
 */
export type DataGridField<T> = DataGridColumn<T>;

/**
 * Іменований набір видимих полів (пресет) — задається кодом сторінки, користувач його
 * не змінює: ручна правка полів переводить грід у єдиний Custom-набір.
 * Порядок `fields` — це і порядок рендера (закріплені поля все одно стоять першими).
 */
export interface DataGridFieldSet {
  id: string;
  label: string;
  fields: string[];
}

/** Зарезервований id Custom-набору; сторінка не може оголосити набір із ним */
export const CUSTOM_FIELD_SET_ID = '__custom';

/**
 * Стан видимості полів у `Grid.Root`. Root НЕ знає пресетів: їх приносить
 * `Grid.FieldSets` і записує сюди вже розвʼязаний список. Зберігаються лише
 * `activeSetId` і `custom`: пресет щоразу застосовується з коду, тож зміна його
 * складу в новому релізі не перекривається старим знімком.
 */
export interface DataGridFieldsState {
  /** id пресета, CUSTOM_FIELD_SET_ID або null — нічого не обрано (дефолти полів) */
  activeSetId: string | null;
  /**
   * Застосований пресет: id + видимі поля. НЕ зберігається. `id` дає FieldSets
   * знати, що активний пресет уже застосований (інакше — застосувати з коду).
   */
  preset: { id: string; fields: string[] } | null;
  /** Custom-набір; null — Custom ще немає */
  custom: DataGridCustomFieldSet | null;
}

/**
 * Custom: видимість і порядок — окремі осі, як у TanStack (`columnVisibility` +
 * `columnOrder`). Видимість — МАПА, а не список видимих id: поле з нового релізу
 * відсутнє в мапі й бере свій `defaultHidden`. Порядок — УСІХ полів, включно з
 * прихованими: вимкнене й знову ввімкнене поле повертається на своє місце.
 */
export interface DataGridCustomFieldSet {
  visible: Record<string, boolean>;
  order: string[];
}

/** Entity-специфічний текст; без нього DataGrid бере дефолт із common (loading/empty) */
export interface DataGridMessages {
  loading?: string;
  empty?: string;
}

export interface DataGridRowAction<T> {
  id: string;
  label: string;
  isDanger?: boolean;
  isVisible?: (item: T) => boolean;
  /** Пункт лишається в меню, але неактивний (React Aria не пускає його в onAction) */
  isDisabled?: (item: T) => boolean;
  onAction: (item: T) => void;
  confirm?: {
    heading: string;
    body: (item: T) => ReactNode;
    confirmLabel: string;
    cancelLabel: string;
  };
}
