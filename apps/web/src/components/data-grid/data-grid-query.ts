import { keepPreviousData } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

/** Спільна форма пагінованої відповіді (paginatedResponseSchema у libs/contracts) */
export interface DataGridListResponse<TItem> {
  items: TItem[];
  total: number;
  totalPages: number;
}

export interface DataGridQueryResult<TItem> {
  items: TItem[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * Готова опція для orval-хука списку — без стрибка спінера на всю таблицю
 * при зміні сторінки/фільтра/сортування (стара сторінка лишається видимою).
 */
export const gridQueryOptions = { placeholderData: keepPreviousData };

/**
 * Розпаковує РЕЗУЛЬТАТ уже викликаного orval-хука (не сам хук — generic
 * над самим хуком ловить одне з 4 його перевантажень і плутає виведення
 * типів). TItem виводиться з конкретного типу query.data в місці виклику.
 */
export function toGridQueryResult<TItem>(
  query: Pick<UseQueryResult<DataGridListResponse<TItem>>, 'data' | 'isLoading' | 'isFetching'>,
): DataGridQueryResult<TItem> {
  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    totalPages: query.data?.totalPages ?? 1,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
