import { useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useDebouncedValue } from '@saas-skeleton/ui/hooks/use-debounced-value';
import { useUsersFindAll } from '../../../../api/generated/api';
import type { PickedOption, UserOption } from './user-option';

/** Скільки юзерів показуємо за раз; решта — через уточнення пошуку */
const PAGE_SIZE = 20;
/** Та сама затримка, що в пошуку гріда (`useDataGridFilters`) і в `UserSelect` */
const SEARCH_DEBOUNCE_MS = 300;

interface UserDirectory {
  /** Сторінка результатів під поточний пошук — те, що показує попап */
  options: UserOption[];
  /** Вибрані id, розгорнуті в ідентичності (у порядку самого `value`) */
  picked: PickedOption[];
  total: number;
  isFetching: boolean;
  query: string;
  setQuery: (next: string) => void;
}

/**
 * Джерело даних для обох варіантів вибору кількох юзерів. Інкапсулює те саме, що
 * `UserSelect` тримає в собі для одиничного вибору: ендпоінт, розмір сторінки,
 * дебаунс, фільтр неактивних — споживач не знає про них нічого.
 *
 * Ключова відмінність від одиничного вибору: там невідому ідентичність можна
 * добрати окремим `useUsersFindOne`, тут вибраних N — а хук у циклі не викличеш.
 * Тому замість запиту на кожен id працює **кеш ідентичностей**: усе, що хоч раз
 * приїхало сторінкою пошуку або прийшло від споживача в `known`, лишається
 * доступним і після того, як наступний пошук звузив список. Без нього щойно
 * доданий юзер зникав би з чипів, щойно ти набрав наступне ім'я.
 */
export function useUserDirectory(selectedIds: string[], known: UserOption[] = []): UserDirectory {
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data, isFetching } = useUsersFindAll(
    {
      search: search || undefined,
      isActive: 'true',
      limit: PAGE_SIZE,
      sortBy: 'name',
      sortOrder: 'asc',
    },
    // placeholderData: між запитами під набір список не має блимати порожнім
    { query: { placeholderData: keepPreviousData } },
  );
  const options = data?.items ?? [];

  // Запис у ref під час рендера — свідомо: кеш нічого не малює сам (жоден рядок
  // не залежить від нього як від стану), а запис ідемпотентний, тож повторний
  // рендер StrictMode нічого не змінює. Ефект тут дав би кадр із порожнім чипом
  // рівно тоді, коли приїхала перша сторінка.
  const cache = useRef(new Map<string, UserOption>());
  for (const user of known) {
    cache.current.set(user.id, user);
  }
  for (const user of options) {
    cache.current.set(user.id, user);
  }

  return {
    options,
    picked: selectedIds.map((id) => cache.current.get(id) ?? { id, pending: true }),
    total: data?.total ?? 0,
    isFetching,
    query,
    setQuery,
  };
}
