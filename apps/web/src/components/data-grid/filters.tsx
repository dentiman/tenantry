import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Input, ListBox, Select, TextField } from '@heroui/react';
import type { DataGridFiltersState } from './use-data-grid-filters';
import type { DataGridFiltersBase } from './types';

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
  className?: string;
}

/** Тулбар фільтрів: рендерить масив filters так само, як DataGrid — columns */
export function DataGridFilters<TFilters extends DataGridFiltersBase>({
  grid,
  filters,
  className,
}: DataGridFiltersProps<TFilters>) {
  return (
    <div className={className ?? 'flex items-center gap-2'}>
      {filters.map((filter) => (
        <Fragment key={filter.id}>{filter.render(grid)}</Fragment>
      ))}
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
    <TextField aria-label={ariaLabel} className={className ?? 'w-64'}>
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </TextField>
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
  return (
    <Select
      aria-label={ariaLabel}
      className={className ?? 'w-48'}
      value={value ?? 'all'}
      onChange={(key) => {
        onChange(key === 'all' ? undefined : String(key));
      }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="all" textValue={allLabel}>
            {allLabel}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
