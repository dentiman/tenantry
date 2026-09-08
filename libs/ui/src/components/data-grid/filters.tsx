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
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';
import { cn } from '@saas-skeleton/ui/lib/utils';

export type DataGridFiltersSize = 'default' | 'sm';
export type DataGridFiltersSurface = 'plain' | 'secondary';

/**
 * Елемент масиву фільтрів — аналог DataGridColumn, але для тулбара. Вбудовані
 * фільтри створюються фабриками defineFilters<TFilters>(); кастомний
 * бізнес-фільтр — будь-який обʼєкт цієї форми (render отримує весь стан гріда).
 */
export interface DataGridFilterDef<TFilters extends DataGridFiltersBase> {
  id: string;
  render: (grid: DataGridFiltersState<TFilters>, size: DataGridFiltersSize) => ReactNode;
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
      render: (grid, size) => (
        <SearchFilterField
          {...options}
          size={size}
          value={grid.searchInput}
          onChange={grid.setSearchInput}
        />
      ),
    }),
    select: (options) => {
      const { key, ...fieldProps } = options;
      return {
        id: key,
        render: (grid, size) => (
          <SelectFilterField
            {...fieldProps}
            size={size}
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
  /** plain — звичайний рядок; secondary — компактна neutral surface на кшталт TabsList */
  surface?: DataGridFiltersSurface;
  /** Розмір усіх control-ів toolbar-а; не змінює дефолтну метрику форм */
  size?: DataGridFiltersSize;
  className?: string;
}

/**
 * `panel` — плаваюча плитка над таблицею (дефолт); `band` — смуга на всю ширину
 * без скруглень, для сторінок у режимі `bleed`, де таблиця сама є полотном.
 */
export type DataGridToolbarSurface = 'panel' | 'band';

interface DataGridToolbarProps<TFilters extends DataGridFiltersBase> {
  grid: DataGridFiltersState<TFilters>;
  filters: DataGridFilterDef<TFilters>[];
  totalLabel: string;
  total: number;
  selectedLabel: string;
  selectedCount: number;
  selectionActions?: ReactNode;
  onClearSelection?: () => void;
  size?: DataGridFiltersSize;
  surface?: DataGridToolbarSurface;
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
  surface = 'plain',
  size = 'default',
  className,
}: DataGridFiltersProps<TFilters>) {
  return (
    <div
      data-slot="data-grid-filters"
      data-surface={surface}
      className={cn('flex items-center justify-between gap-2', className)}
    >
      <div
        className={cn(
          'flex max-w-full flex-col-reverse items-start sm:flex-row sm:items-center',
          surface === 'plain' ? 'flex-1 gap-2' : 'w-fit gap-1 rounded-lg bg-secondary p-1',
        )}
      >
        <DataGridFilterControls grid={grid} filters={filters} size={size} />
      </div>
      {actions}
    </div>
  );
}

/**
 * Контекстна панель списку: filters у звичайному стані, bulk actions — коли є вибір.
 * Обидва стани лежать в одній grid-комірці; невидимий стан продовжує визначати
 * розміри track-а, тому surface не стрибає за висотою чи шириною під час перемикання.
 */
export function DataGridToolbar<TFilters extends DataGridFiltersBase>({
  grid,
  filters,
  totalLabel,
  total,
  selectedLabel,
  selectedCount,
  selectionActions,
  onClearSelection,
  size = 'sm',
  surface = 'panel',
  className,
}: DataGridToolbarProps<TFilters>) {
  const { t } = useTranslation('common');
  const isSelectionMode = selectedCount > 0;
  const rowClassName =
    'col-start-1 row-start-1 flex min-h-8 max-w-full flex-wrap items-center gap-1';

  return (
    <div
      data-slot="data-grid-toolbar"
      data-mode={isSelectionMode ? 'selection' : 'filters'}
      data-surface={surface}
      className={cn(
        'grid max-w-full',
        surface === 'panel'
          ? // Плитка — КОНТРОЛ над полотном, їй належить виділятись: `secondary`
            // це найконтрастніша нейтраль теми
            'w-fit rounded-lg bg-secondary p-1'
          : // Смуга — ШАСІ, а не контрол: краї віддані вікну, і фон мусить бути
            // тихим. Звідси `sidebar`, а не `secondary`: розтягнутий на всю
            // ширину, той кричав. Токен обраний за роллю — це та сама поверхня,
            // що ліва колонка, тобто обрамлення робочої області; у темряві він
            // до того ж дорівнює `card`, тобто шапці календарної сітки.
            //
            // Бокове поле — 16px, а не 24px шела: перший елемент (метрика) несе
            // власні `pl-2`, і разом виходить рівно 24px — та сама вертикаль,
            // що в комірок таблиці
            'w-full rounded-none bg-sidebar px-4 py-1',
        className,
      )}
    >
      <div
        aria-hidden={isSelectionMode}
        className={cn(rowClassName, isSelectionMode && 'invisible pointer-events-none')}
      >
        <DataGridToolbarMetric label={totalLabel} value={total} />
        <Separator orientation="vertical" className="mx-1 my-1 hidden sm:block" />
        <DataGridFilterControls grid={grid} filters={filters} size={size} />
      </div>

      <div
        aria-hidden={!isSelectionMode}
        className={cn(rowClassName, !isSelectionMode && 'invisible pointer-events-none')}
      >
        <DataGridToolbarMetric label={selectedLabel} value={selectedCount} />
        <Separator orientation="vertical" className="mx-1 my-1 hidden sm:block" />
        {selectionActions}
        {onClearSelection && (
          <Button variant="toolbar" size={size} onClick={onClearSelection}>
            {t('selection.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

function DataGridToolbarMetric({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex h-8 items-center gap-1 pl-2 text-sm whitespace-nowrap">
      <span className="font-medium text-muted-foreground">{label}:</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </p>
  );
}

function DataGridFilterControls<TFilters extends DataGridFiltersBase>({
  grid,
  filters,
  size,
}: {
  grid: DataGridFiltersState<TFilters>;
  filters: DataGridFilterDef<TFilters>[];
  size: DataGridFiltersSize;
}) {
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
    <>
      {filters.map((filter) => (
        <Fragment key={filter.id}>{filter.render(grid, size)}</Fragment>
      ))}
      {isFiltered && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={t('filters.reset')}
                variant="toolbar"
                size={size === 'sm' ? 'icon-sm' : 'icon'}
                radius="full"
                onClick={reset}
              >
                <X />
              </Button>
            }
          />
          <TooltipContent>{t('filters.reset')}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

interface SearchFilterFieldProps extends SearchFilterOptions {
  size: DataGridFiltersSize;
  value: string;
  onChange: (value: string) => void;
}

function SearchFilterField({
  ariaLabel,
  placeholder,
  size,
  value,
  onChange,
  className,
}: SearchFilterFieldProps) {
  return (
    <Input
      type="search"
      size={size}
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
  size: DataGridFiltersSize;
  onChange: (value: string | undefined) => void;
  className?: string;
}

/** Значення "all" ↔ undefined (немає фільтра в URL) */
function SelectFilterField({
  ariaLabel,
  allLabel,
  value,
  options,
  size,
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
      <SelectTrigger aria-label={ariaLabel} size={size} className={className ?? 'w-48'}>
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
