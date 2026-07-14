import { useCallback, useMemo, useState } from 'react';

/**
 * Стан вибору рядків гріда. Джерело правди — Map id → снапшот рядка: при серверній
 * пагінації обрані рядки з інших сторінок уже не завантажені, тому зберігаємо сам T
 * на момент вибору. Вибір накопичується між сторінками; хедер-чекбокс діє на поточну.
 * Вибір навмисно НЕ через selectionMode React Aria (клік по рядку не обирає) —
 * тільки власні контрольовані чекбокси в DataGrid.
 */
export interface DataGridSelectionState<T> {
  /** Обрані рядки цілком — сторінка сама вирішує, що з них показувати/робити */
  selectedItems: T[];
  /** id обраних рядків — DataGrid малює по них стан чекбоксів */
  selectedIds: ReadonlySet<string>;
  clear: () => void;
  /** Викликає DataGrid із чекбокса рядка */
  toggle: (id: string, item: T) => void;
  /** Викликає DataGrid із хедер-чекбокса: обрати/зняти всі рядки сторінки */
  setPage: (entries: readonly (readonly [string, T])[], selected: boolean) => void;
}

/**
 * Пара до useDataGridFilters: стан вибору живе на сторінці (їй потрібні selectedItems
 * для тулбара/масових дій), чекбокси — усередині DataGrid через проп selection.
 */
export function useDataGridSelection<T>(): DataGridSelectionState<T> {
  const [selected, setSelected] = useState<ReadonlyMap<string, T>>(new Map());

  const toggle = useCallback((id: string, item: T): void => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, item);
      }
      return next;
    });
  }, []);

  const setPage = useCallback(
    (entries: readonly (readonly [string, T])[], isSelected: boolean): void => {
      setSelected((prev) => {
        const next = new Map(prev);
        for (const [id, item] of entries) {
          if (isSelected) {
            next.set(id, item);
          } else {
            next.delete(id);
          }
        }
        return next;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setSelected(new Map());
  }, []);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  return { selectedItems, selectedIds, clear, toggle, setPage };
}
