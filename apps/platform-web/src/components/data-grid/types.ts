import type { ReactNode } from 'react';
import type { SortDescriptor } from '@heroui/react';

export type SortOrder = 'asc' | 'desc';

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
  /** Ідентифікатор колонки; для sortable-колонок = значення sortBy в API */
  id: string;
  header: string;
  cell: (item: T) => ReactNode;
  sortable?: boolean;
  isRowHeader?: boolean;
  align?: 'start' | 'end';
  className?: string;
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
