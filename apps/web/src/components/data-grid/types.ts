import type { ReactNode } from 'react';
import type { SortDescriptor } from '@heroui/react';

export type SortOrder = 'asc' | 'desc';

/**
 * Мінімальна форма search-стану гріда: page/sortBy/sortOrder/search — решта полів
 * (фільтри) — довільні, специфічні для сторінки. Той самий тип, що й route-схема
 * сторінки (TanStack Router search), якщо грід синхронізується з URL.
 */
export interface DataGridSearchBase {
  page?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

/** Те, що DataGrid реально читає з grid-стану — не залежить від конкретного TSearch */
export interface DataGridNavigation {
  page: number;
  sortDescriptor: SortDescriptor | undefined;
  onSortChange: (descriptor: SortDescriptor) => void;
  goToPage: (page: number) => void;
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
  onAction: (item: T) => void;
  confirm?: {
    heading: string;
    body: (item: T) => ReactNode;
    confirmLabel: string;
    cancelLabel: string;
  };
}
