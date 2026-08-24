import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { fromSortDescriptor, toSortDescriptor } from './sort';
import { DEFAULT_PAGE_LIMIT } from './types';
import type { DataGridFiltersBase, DataGridNavigation } from './types';

interface UseDataGridFiltersOptions<TFilters extends DataGridFiltersBase> {
  /**
   * true (дефолт) — фільтри живуть у search-параметрах поточного роуту (URL query):
   * шерабельний лінк, F5 і back/forward працюють. Роут МУСИТЬ мати validateSearch
   * зі схемою, що відповідає TFilters (див. router.tsx) — вона і є runtime-гарантією типу.
   * false — локальний useState: для другого гріда на сторінці чи гріда в модалці.
   */
  syncToUrl?: boolean;
  /** Стартові фільтри для syncToUrl: false (в URL-режимі стартовий стан = сам URL) */
  initialValue?: TFilters;
  searchDebounceMs?: number;
}

export interface DataGridFiltersState<
  TFilters extends DataGridFiltersBase,
> extends DataGridNavigation {
  /** Поточні фільтри цілком — сторінка спредить їх у params запиту списку */
  filters: TFilters;
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** Патчить довільні поля фільтрів і скидає page — окремо від search (без debounce) */
  setFilter: (patch: Partial<Omit<TFilters, 'page'>>) => void;
}

const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Весь стан списку одним хуком: пошук із debounce (+ синхронізація back/forward),
 * скидання page при зміні фільтра/сортування, міст SortDescriptor ↔
 * sortBy/sortOrder. Роутер інжектиться всередині — сторінка не робить проводки.
 * Стан свідомо ПОВЕРТАЄТЬСЯ сторінці (а не ховається в <DataGrid>): fetching
 * лишається за сторінкою, а їй для params потрібен grid.filters ДО рендера гріда.
 * Один хук — один DataGrid; кілька грідів = кілька викликів (URL-режим лише в одного).
 */
export function useDataGridFilters<TFilters extends DataGridFiltersBase = DataGridFiltersBase>(
  options: UseDataGridFiltersOptions<TFilters> = {},
): DataGridFiltersState<TFilters> {
  const {
    syncToUrl = true,
    initialValue = {} as TFilters,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  } = options;

  // Rules of Hooks: обидва режими ініціалізуються завжди, невибраний — ігнорується.
  // strict: false — хук не знає свого роуту; runtime-форму TFilters гарантує
  // validateSearch роуту, тому касти нижче локалізовані й безпечні
  const rawSearch: unknown = useSearch({ strict: false });
  const urlFilters = rawSearch as TFilters;
  const navigate = useNavigate();
  const [localFilters, setLocalFilters] = useState<TFilters>(initialValue);

  const filters = syncToUrl ? urlFilters : localFilters;

  // navigate типізований merged-схемою ВСІХ роутів — роутер-агностичний хук її не
  // знає, тому navigate перетипізовано до фактично використовуваної сигнатури
  const navigateSearch = navigate as unknown as (opts: {
    to: '.';
    replace: boolean;
    search: (prev: TFilters) => TFilters;
  }) => Promise<void>;

  const applyChange = (updater: (prev: TFilters) => TFilters, replace = false): void => {
    if (syncToUrl) {
      void navigateSearch({ to: '.', replace, search: updater });
    } else {
      setLocalFilters(updater);
    }
  };
  // "Останній" applyChange у ref — debounce-ефект не має перезапускатись щорендера
  const applyChangeRef = useRef(applyChange);
  applyChangeRef.current = applyChange;

  const search = filters.search ?? '';
  const [searchInput, setSearchInput] = useState(search);
  // Останнє значення, яке МИ поклали в стан — відрізняє наш апдейт від зовнішнього
  // (back/forward для URL-режиму; сторонній setState — для локального)
  const pushedSearchRef = useRef(search);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        pushedSearchRef.current = searchInput;
        // replace: набирання в пошуку — це уточнення, а не крок історії браузера
        applyChangeRef.current(
          (prev) => ({ ...prev, search: searchInput || undefined, page: undefined }),
          true,
        );
      }
    }, searchDebounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput, search, searchDebounceMs]);

  useEffect(() => {
    if (search !== pushedSearchRef.current) {
      pushedSearchRef.current = search;
      setSearchInput(search);
    }
  }, [search]);

  const setFilter = (patch: Partial<Omit<TFilters, 'page'>>): void => {
    applyChange((prev) => ({ ...prev, ...patch, page: undefined }));
  };

  const goToPage = (page: number): void => {
    applyChange((prev) => ({ ...prev, page: page <= 1 ? undefined : page }));
  };

  const setLimit = (limit: number): void => {
    // Дефолтний ліміт зникає з URL (як page 1); зміна розміру сторінки скидає page
    applyChange((prev) => ({
      ...prev,
      limit: limit === DEFAULT_PAGE_LIMIT ? undefined : limit,
      page: undefined,
    }));
  };

  const onSortChange: DataGridNavigation['onSortChange'] = (descriptor) => {
    const next = fromSortDescriptor(descriptor);
    // descriptor.column — React Aria Key (string), TFilters['sortBy'] — закритий enum
    // конкретної сторінки; звузити тут неможливо без знання цього enum
    setFilter({
      sortBy: next.sortBy,
      sortOrder: next.sortOrder,
    } as Partial<Omit<TFilters, 'page'>>);
  };

  return {
    filters,
    page: filters.page ?? 1,
    limit: filters.limit ?? DEFAULT_PAGE_LIMIT,
    searchInput,
    setSearchInput,
    sortDescriptor: toSortDescriptor(filters.sortBy, filters.sortOrder),
    onSortChange,
    goToPage,
    setLimit,
    setFilter,
  };
}
