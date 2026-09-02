import { useEffect, useState } from 'react';

/**
 * Значення, що доганяє вхідне із затримкою: віддає останнє, яке не змінювалось
 * `delayMs`. Потрібне там, де кожна зміна коштує запиту на сервер (пошук у
 * комбобоксі), але сам стан поля мусить лишатись миттєвим — інакше в інпуті
 * з'являлось би відлуння набраного тексту.
 *
 * Свідомо окремо від debounce у `useDataGridFilters`: той вшитий у стан списку
 * (навігація роутера, скидання page) і поза грідом не переюзається.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
