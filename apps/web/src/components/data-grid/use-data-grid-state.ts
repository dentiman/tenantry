import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { fromSortDescriptor, toSortDescriptor } from './sort';
import type { DataGridNavigation, DataGridSearchBase } from './types';

interface UseDataGridStateOptions<TSearch extends DataGridSearchBase> {
  /**
   * true (дефолт) — стан живе в search-параметрах поточного роуту: шерабельний
   * лінк, F5 і back/forward працюють. Роут МУСИТЬ мати validateSearch зі схемою,
   * що відповідає TSearch (див. router.tsx) — вона і є runtime-гарантією типу.
   * false — локальний useState: для другого гріда на сторінці чи гріда в модалці.
   */
  syncToUrl?: boolean;
  /** Стартовий стан для syncToUrl: false (в URL-режимі стартовий стан = сам URL) */
  initialValue?: TSearch;
  searchDebounceMs?: number;
}

export interface DataGridState<TSearch extends DataGridSearchBase> extends DataGridNavigation {
  value: TSearch;
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** Патчить довільні поля (фільтри) стану й скидає page — окремо від search (без debounce) */
  setFilter: (patch: Partial<Omit<TSearch, 'page'>>) => void;
}

const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Весь стан списку одним хуком: пошук із debounce (+ синхронізація back/forward),
 * скидання page при зміні фільтра/сортування, міст SortDescriptor (HeroUI) ↔
 * sortBy/sortOrder. Роутер інжектиться всередині — сторінка не робить проводки.
 * Стан свідомо ПОВЕРТАЄТЬСЯ сторінці (а не ховається в <DataGrid>): fetching
 * лишається за сторінкою, а їй для params потрібен grid.value ДО рендера гріда.
 * Один хук — один DataGrid; кілька грідів = кілька викликів (URL-режим лише в одного).
 */
export function useDataGridState<TSearch extends DataGridSearchBase = DataGridSearchBase>(
  options: UseDataGridStateOptions<TSearch> = {},
): DataGridState<TSearch> {
  const {
    syncToUrl = true,
    initialValue = {} as TSearch,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  } = options;

  // Rules of Hooks: обидва режими ініціалізуються завжди, невибраний — ігнорується.
  // strict: false — хук не знає свого роуту; runtime-форму TSearch гарантує
  // validateSearch роуту, тому касти нижче локалізовані й безпечні
  const rawSearch: unknown = useSearch({ strict: false });
  const urlSearch = rawSearch as TSearch;
  const navigate = useNavigate();
  const [localValue, setLocalValue] = useState<TSearch>(initialValue);

  const value = syncToUrl ? urlSearch : localValue;

  // navigate типізований merged-схемою ВСІХ роутів — роутер-агностичний хук її не
  // знає, тому navigate перетипізовано до фактично використовуваної сигнатури
  const navigateSearch = navigate as unknown as (opts: {
    to: '.';
    replace: boolean;
    search: (prev: TSearch) => TSearch;
  }) => Promise<void>;

  const applyChange = (updater: (prev: TSearch) => TSearch, replace = false): void => {
    if (syncToUrl) {
      void navigateSearch({ to: '.', replace, search: updater });
    } else {
      setLocalValue(updater);
    }
  };
  // "Останній" applyChange у ref — debounce-ефект не має перезапускатись щорендера
  const applyChangeRef = useRef(applyChange);
  applyChangeRef.current = applyChange;

  const search = value.search ?? '';
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

  const setFilter = (patch: Partial<Omit<TSearch, 'page'>>): void => {
    applyChange((prev) => ({ ...prev, ...patch, page: undefined }));
  };

  const goToPage = (page: number): void => {
    applyChange((prev) => ({ ...prev, page: page <= 1 ? undefined : page }));
  };

  const onSortChange: DataGridNavigation['onSortChange'] = (descriptor) => {
    const next = fromSortDescriptor(descriptor);
    // descriptor.column — React Aria Key (string), TSearch['sortBy'] — закритий enum
    // конкретної сторінки; звузити тут неможливо без знання цього enum
    setFilter({
      sortBy: next.sortBy,
      sortOrder: next.sortOrder,
    } as Partial<Omit<TSearch, 'page'>>);
  };

  return {
    value,
    page: value.page ?? 1,
    searchInput,
    setSearchInput,
    sortDescriptor: toSortDescriptor(value.sortBy, value.sortOrder),
    onSortChange,
    goToPage,
    setFilter,
  };
}
