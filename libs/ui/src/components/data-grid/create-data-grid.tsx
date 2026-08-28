import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DataGrid } from './data-grid';
import type { DataGridSurface } from './data-grid';
import { DataGridFilters, defineFilters } from './filters';
import type { DataGridFilterDef } from './filters';
import { gridQueryOptions, toGridQueryResult } from './data-grid-query';
import type { DataGridListResponse, DataGridQueryResult } from './data-grid-query';
import { useDataGridFilters } from './use-data-grid-filters';
import type { DataGridFiltersState } from './use-data-grid-filters';
import { useDataGridSelection } from './use-data-grid-selection';
import type { DataGridSelectionState } from './use-data-grid-selection';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import type {
  DataGridColumn,
  DataGridFiltersBase,
  DataGridMessages,
  DataGridRowAction,
} from './types';

/** Базові query-опції, які Root передає в замикання useListQuery (keepPreviousData) */
export type DataGridQueryBaseOptions = typeof gridQueryOptions;

/**
 * Декларація «як фетчити список» — єдина бізнес-частина фетчингу, що лишається
 * сторінці. Замикання МУСИТЬ безумовно викликати один і той самий orval-хук
 * (воно виконується як хук усередині Root — Rules of Hooks) і прокинути
 * gridOptions у query-опції (можна розширити, напр. refetchInterval).
 */
export type DataGridUseListQuery<TFilters, TItem> = (
  params: TFilters & { page: number },
  gridOptions: DataGridQueryBaseOptions,
) => Pick<UseQueryResult<DataGridListResponse<TItem>>, 'data' | 'isLoading' | 'isPlaceholderData'>;

interface DataGridContextValue<TFilters extends DataGridFiltersBase, TItem> {
  grid: DataGridFiltersState<TFilters>;
  list: DataGridQueryResult<TItem>;
  selection: DataGridSelectionState<TItem> | undefined;
}

interface DataGridRootProps<TFilters extends DataGridFiltersBase, TItem> {
  useListQuery: DataGridUseListQuery<TFilters, TItem>;
  /** true — вибір рядків усередині Root; або зовнішній стан (controlled) для
   *  реакції на вибір поза розміткою гріда. Без пропа чекбоксів немає. */
  selection?: boolean | DataGridSelectionState<TItem>;
  /** Пас-тру в useDataGridFilters: false — локальний стан замість URL */
  syncToUrl?: boolean;
  initialValue?: TFilters;
  searchDebounceMs?: number;
  children: ReactNode;
}

interface DataGridTableProps<TItem> {
  ariaLabel: string;
  columns: DataGridColumn<TItem>[];
  rowActions?: DataGridRowAction<TItem>[];
  getRowId?: (item: TItem) => string;
  /** Варіанти «Items per page» у футері; false — прибрати селект зовсім */
  pageSizeOptions?: number[] | false;
  messages?: DataGridMessages;
  /** Візуальна поверхня таблиці; card робить таблицю flush, а separator-и — inset */
  surface?: DataGridSurface;
}

interface DataGridFiltersSlotProps<TFilters extends DataGridFiltersBase> {
  filters: DataGridFilterDef<TFilters>[];
  className?: string;
}

interface DataGridSelectionSummaryProps<TItem> {
  /** Додаткові bulk-дії поруч зі зведенням — отримують стан вибору */
  children?: (selection: DataGridSelectionState<TItem>) => ReactNode;
  className?: string;
}

export interface DataGridInstance<
  TFilters extends DataGridFiltersBase,
  TItem extends { id: string },
> {
  /** Тримає весь стан гріда (фільтри в URL, query, вибір) і роздає його дітям контекстом */
  Root: (props: DataGridRootProps<TFilters, TItem>) => ReactNode;
  /** Тулбар фільтрів — grid більше не проп, а контекст */
  Filters: (props: DataGridFiltersSlotProps<TFilters>) => ReactNode;
  /** Таблиця з сортуванням/пагінацією/чекбоксами — дані з контексту */
  Table: (props: DataGridTableProps<TItem>) => ReactNode;
  /** «N обрано» + Clear; рендериться лише коли щось обрано */
  SelectionSummary: (props: DataGridSelectionSummaryProps<TItem>) => ReactNode;
  /** Фабрики вбудованих фільтрів, уже привʼязані до TFilters (див. defineFilters) */
  filter: ReturnType<typeof defineFilters<TFilters>>;
}

/**
 * Фабрика типізованого компаунд-набору DataGrid для однієї сторінки (аналог
 * defineFilters: замикання фіксує TFilters/TItem один раз на рівні модуля —
 * контекст і всі діти повністю типізовані без кастів у сторінці).
 * Headless-хуки (useDataGridFilters/useDataGridSelection) лишаються експортованими
 * як escape hatch для нестандартних сторінок.
 */
export function createDataGrid<
  TFilters extends DataGridFiltersBase,
  TItem extends { id: string },
>(): DataGridInstance<TFilters, TItem> {
  // Свій контекст на кожен виклик фабрики — тому він типізований без generic-трюків
  const Context = createContext<DataGridContextValue<TFilters, TItem> | null>(null);

  function useGridContext(): DataGridContextValue<TFilters, TItem> {
    const ctx = useContext(Context);
    if (!ctx) {
      throw new Error('DataGrid compound components must be rendered inside <Grid.Root>');
    }
    return ctx;
  }

  function Root({
    useListQuery,
    selection,
    syncToUrl,
    initialValue,
    searchDebounceMs,
    children,
  }: DataGridRootProps<TFilters, TItem>) {
    const grid = useDataGridFilters<TFilters>({ syncToUrl, initialValue, searchDebounceMs });
    // Rules of Hooks: внутрішній стан вибору створюється завжди, без пропа — ігнорується
    const internalSelection = useDataGridSelection<TItem>();
    const list = toGridQueryResult(
      useListQuery({ ...grid.filters, page: grid.page }, gridQueryOptions),
    );
    const selectionState =
      selection === true ? internalSelection : selection === false ? undefined : selection;

    // Зміна ЗВУЖУВАЛЬНИХ фільтрів (пошук/доменні) робить накопичений вибір
    // неактуальним — скидаємо. page/limit не враховуються (вибір навмисно
    // накопичується між сторінками), сортування теж (не змінює склад результату).
    const { filters } = grid;
    const narrowingKey = useMemo(() => {
      // Каст безпечний: TFilters — plain-обʼєкт search params (validateSearch роуту)
      const narrowing = { ...(filters as Record<string, unknown>) };
      delete narrowing.page;
      delete narrowing.limit;
      delete narrowing.sortBy;
      delete narrowing.sortOrder;
      // Ключі відсортовано — порядок полів у search params не має спричиняти скид
      return JSON.stringify(narrowing, Object.keys(narrowing).sort());
    }, [filters]);
    const clearSelection = selectionState?.clear;
    // Стартовий ключ у ref — на маунті не скидаємо (controlled-вибір міг прийти непорожнім)
    const prevNarrowingKeyRef = useRef(narrowingKey);
    useEffect(() => {
      if (prevNarrowingKeyRef.current === narrowingKey) {
        return;
      }
      prevNarrowingKeyRef.current = narrowingKey;
      clearSelection?.();
    }, [narrowingKey, clearSelection]);

    return (
      <Context.Provider value={{ grid, list, selection: selectionState }}>
        {children}
      </Context.Provider>
    );
  }

  function Filters({ filters, className }: DataGridFiltersSlotProps<TFilters>) {
    const { grid } = useGridContext();
    return <DataGridFilters grid={grid} filters={filters} className={className} />;
  }

  function Table(props: DataGridTableProps<TItem>) {
    const { grid, list, selection } = useGridContext();
    return <DataGrid {...props} grid={grid} list={list} selection={selection} />;
  }

  function SelectionSummary({ children, className }: DataGridSelectionSummaryProps<TItem>) {
    const { selection } = useGridContext();
    const { t } = useTranslation('common');
    if (!selection || selection.selectedItems.length === 0) {
      return null;
    }
    return (
      <div className={className ?? 'mb-3 flex items-center gap-2'}>
        <span className="text-sm text-muted-foreground">
          {t('selection.summary', { count: selection.selectedItems.length })}
        </span>
        <Button size="sm" variant="ghost" onClick={selection.clear}>
          {t('selection.clear')}
        </Button>
        {children?.(selection)}
      </div>
    );
  }

  return { Root, Filters, Table, SelectionSummary, filter: defineFilters<TFilters>() };
}
