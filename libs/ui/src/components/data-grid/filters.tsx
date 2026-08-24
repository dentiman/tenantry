import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import type { DataGridFiltersState } from './use-data-grid-filters';
import type { DataGridFiltersBase } from './types';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';

/**
 * Елемент масиву фільтрів — аналог DataGridColumn, але для тулбара. Вбудовані
 * фільтри створюються фабриками defineFilters<TFilters>(); кастомний
 * бізнес-фільтр — будь-який обʼєкт цієї форми (render отримує весь стан гріда).
 */
export interface DataGridFilterDef<TFilters extends DataGridFiltersBase> {
  id: string;
  render: (grid: DataGridFiltersState<TFilters>) => ReactNode;
}

/** Ключі TFilters зі string-значеннями — лише такі можна фільтрувати селектом */
type SelectFilterKey<TFilters> = {
  [K in Extract<keyof TFilters, string>]: NonNullable<TFilters[K]> extends string ? K : never;
}[Extract<keyof TFilters, string>];

interface SearchFilterOptions {
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

interface SelectFilterOptions<TFilters, K extends SelectFilterKey<TFilters>> {
  /** Поле TFilters, яким керує селект; id опцій — закритий тип цього поля */
  key: K;
  ariaLabel: string;
  /** Пункт «без фільтра» — значення undefined (ключ зникає з URL) */
  allLabel: string;
  options: { id: NonNullable<TFilters[K]> & string; label: string }[];
  className?: string;
}

/**
 * Фабрики вбудованих фільтрів, привʼязані до TFilters сторінки. Саме виклик-замикання
 * (а не вільні generic-функції): у масиві DataGridFilterDef<TFilters>[] TS не виведе
 * TFilters з аргументів — фіксація типу тут дає повний вивід key/options без
 * type-аргументів у кожному елементі.
 */
export function defineFilters<TFilters extends DataGridFiltersBase>(): {
  search: (options: SearchFilterOptions) => DataGridFilterDef<TFilters>;
  select: <K extends SelectFilterKey<TFilters>>(
    options: SelectFilterOptions<TFilters, K>,
  ) => DataGridFilterDef<TFilters>;
} {
  return {
    /** Текстовий пошук: debounce уже в useDataGridFilters, поле filters.search */
    search: (options) => ({
      id: 'search',
      render: (grid) => (
        <SearchFilterField {...options} value={grid.searchInput} onChange={grid.setSearchInput} />
      ),
    }),
    select: (options) => {
      const { key, ...fieldProps } = options;
      return {
        id: key,
        render: (grid) => (
          <SelectFilterField
            {...fieldProps}
            value={grid.filters[key] as string | undefined}
            onChange={(value) => {
              // Компʼютед-ключ не звузити до Partial<TFilters> — тип гарантує сигнатура select()
              grid.setFilter({ [key]: value } as Partial<Omit<TFilters, 'page'>>);
            }}
          />
        ),
      };
    },
  };
}

interface DataGridFiltersProps<TFilters extends DataGridFiltersBase> {
  grid: DataGridFiltersState<TFilters>;
  filters: DataGridFilterDef<TFilters>[];
  /** Дії праворуч у тому ж рядку (напр. перемикач вигляду) */
  actions?: ReactNode;
  className?: string;
}

/** Поля фільтрів, які не рахуються «фільтром» для кнопки скидання */
const NON_FILTER_KEYS = new Set(['page', 'limit', 'sortBy', 'sortOrder']);

/**
 * Тулбар списку — окремий рядок НАД таблицею (розкладка satnaing/shadcn-admin,
 * `components/data-table/toolbar.tsx`): ліворуч пошук і фільтри, які на вузькому
 * екрані стають колонкою, праворуч — місце для дій. Кнопка «Reset» зʼявляється
 * лише коли є що скидати.
 *
 * Фільтри рендеряться масивом так само, як DataGrid рендерить columns.
 */
export function DataGridFilters<TFilters extends DataGridFiltersBase>({
  grid,
  filters,
  actions,
  className,
}: DataGridFiltersProps<TFilters>) {
  const { t } = useTranslation('common');
  const activeKeys = Object.entries(grid.filters).filter(
    ([key, value]) => !NON_FILTER_KEYS.has(key) && value !== undefined && value !== '',
  );
  const isFiltered = activeKeys.length > 0 || grid.searchInput !== '';

  const reset = (): void => {
    grid.setSearchInput('');
    grid.setFilter(
      Object.fromEntries(activeKeys.map(([key]) => [key, undefined])) as Partial<
        Omit<TFilters, 'page'>
      >,
    );
  };

  return (
    <div className={className ?? 'flex items-center justify-between gap-2'}>
      <div className="flex flex-1 flex-col-reverse items-start gap-2 sm:flex-row sm:items-center">
        {filters.map((filter) => (
          <Fragment key={filter.id}>{filter.render(grid)}</Fragment>
        ))}
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={reset}>
            {t('filters.reset')}
            <X />
          </Button>
        )}
      </div>
      {actions}
    </div>
  );
}

interface SearchFilterFieldProps extends SearchFilterOptions {
  value: string;
  onChange: (value: string) => void;
}

function SearchFilterField({
  ariaLabel,
  placeholder,
  value,
  onChange,
  className,
}: SearchFilterFieldProps) {
  return (
    <Input
      type="search"
      aria-label={ariaLabel}
      className={className ?? 'w-64'}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}

interface SelectFilterFieldProps {
  ariaLabel: string;
  allLabel: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (value: string | undefined) => void;
  className?: string;
}

/** Значення "all" ↔ undefined (немає фільтра в URL) */
function SelectFilterField({
  ariaLabel,
  allLabel,
  value,
  options,
  onChange,
  className,
}: SelectFilterFieldProps) {
  // Base UI вимагає items на корені — з нього рендериться підпис у тригері
  const items = [
    { value: 'all', label: allLabel },
    ...options.map((option) => ({ value: option.id, label: option.label })),
  ];

  return (
    <Select
      items={items}
      value={value ?? 'all'}
      onValueChange={(next: string | null) => {
        // null приходить лише як placeholder-значення Base UI; у нас його немає
        onChange(next === null || next === 'all' ? undefined : next);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className={className ?? 'w-48'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
