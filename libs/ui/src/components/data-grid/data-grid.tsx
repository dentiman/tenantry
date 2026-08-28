import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  MoreHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { pageItems } from '../../lib/page-items';
import type { DataGridQueryResult } from './data-grid-query';
import type { DataGridSelectionState } from './use-data-grid-selection';
import { DEFAULT_PAGE_SIZE_OPTIONS } from './types';
import type {
  DataGridColumn,
  DataGridMessages,
  DataGridNavigation,
  DataGridRowAction,
} from './types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import { Checkbox } from '@saas-skeleton/ui/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader } from '@saas-skeleton/ui/components/ui/empty';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '@saas-skeleton/ui/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';

interface DataGridProps<T extends { id: string }> {
  ariaLabel: string;
  columns: DataGridColumn<T>[];
  rowActions?: DataGridRowAction<T>[];
  /** За замовчуванням — item.id (усі сутності мають uuid id); переозначити для інших ключів */
  getRowId?: (item: T) => string;

  /** Сортування й пагінація — з useDataGridFilters(); URL-синхронізація опціональна там */
  grid: DataGridNavigation;
  /** Дані й стан фетчингу — з toGridQueryResult(); DataGrid сам нічого не запитує */
  list: DataGridQueryResult<T>;

  /** Мультивибір рядків — з useDataGridSelection(); без пропа чекбоксів немає */
  selection?: DataGridSelectionState<T>;

  /** Варіанти «Items per page» у футері; false — прибрати селект зовсім */
  pageSizeOptions?: number[] | false;

  messages?: DataGridMessages;
  /** bordered — legacy wrapper; card — flush table with inset separators on Card */
  surface?: DataGridSurface;
}

export type DataGridSurface = 'bordered' | 'card';

function DataGridTableSurface({
  children,
  surface,
}: {
  children: ReactNode;
  surface: DataGridSurface;
}) {
  if (surface === 'card') {
    return (
      <Card size="sm" className="gap-0 py-0">
        <CardContent className="px-0">{children}</CardContent>
      </Card>
    );
  }

  return <div className="overflow-hidden rounded-xl border border-border bg-card">{children}</div>;
}

/** Селект «Items per page» у футері; той самий Select, що й фільтри тулбара */
function PageSizeSelect({
  limit,
  options,
  onChange,
}: {
  limit: number;
  options: number[];
  onChange: (limit: number) => void;
}) {
  const { t } = useTranslation('common');
  // Ліміт з URL може не бути серед options — додаємо, щоб Select завжди мав вибране значення
  const values = options.includes(limit) ? options : [...options, limit].sort((a, b) => a - b);
  const items = values.map((value) => ({ value: String(value), label: String(value) }));

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm whitespace-nowrap text-muted-foreground">
        {t('pagination.perPage')}
      </span>
      <Select
        items={items}
        value={String(limit)}
        onValueChange={(next: string | null) => {
          if (next !== null) {
            onChange(Number(next));
          }
        }}
      >
        <SelectTrigger aria-label={t('pagination.perPage')} size="sm" className="w-20">
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
    </div>
  );
}

/**
 * Уніфікований список для серверних колекцій. Колонки/екшени — ззовні (page-специфічні),
 * сортування/пагінація — з grid, дані — з list (обидва з useDataGridFilters/toGridQueryResult).
 */
export function DataGrid<T extends { id: string }>({
  ariaLabel,
  columns,
  rowActions,
  getRowId = (item) => item.id,
  grid,
  list,
  selection,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  messages,
  surface = 'bordered',
}: DataGridProps<T>) {
  const { page, limit, sortDescriptor, onSortChange, goToPage, setLimit } = grid;
  const { items, total, totalPages, isLoading, isPlaceholderData } = list;
  const { t } = useTranslation('common');
  const loadingLabel = messages?.loading ?? t('loading');
  const emptyMessage = messages?.empty ?? t('empty');
  const paginationSummary = t('pagination.summary', { total, page, totalPages });
  // Стан хедер-чекбокса відносно ПОТОЧНОЇ сторінки (вибір з інших сторінок не враховується)
  const pageRowIds = selection ? items.map(getRowId) : [];
  const allPageSelected =
    selection !== undefined &&
    pageRowIds.length > 0 &&
    pageRowIds.every((id) => selection.selectedIds.has(id));
  const somePageSelected =
    selection !== undefined &&
    !allPageSelected &&
    pageRowIds.some((id) => selection.selectedIds.has(id));
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: DataGridRowAction<T>;
    item: T;
  } | null>(null);
  const columnCount = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={loadingLabel} />
      </div>
    );
  }

  const handleRowAction = (item: T, action: DataGridRowAction<T>): void => {
    if (action.confirm) {
      // pendingAction навмисно НЕ скидається на закриття — інакше під час
      // анімації закриття діалог встигає промигнути порожнім вмістом
      setPendingAction({ action, item });
      setIsConfirmOpen(true);
    } else {
      action.onAction(item);
    }
  };

  /** Той самий цикл, що давав React Aria: та сама колонка → зміна напряму, інша → ascending */
  const toggleSort = (columnId: string): void => {
    const isCurrent = sortDescriptor?.column === columnId;
    onSortChange({
      column: columnId,
      direction: isCurrent && sortDescriptor.direction === 'ascending' ? 'descending' : 'ascending',
    });
  };

  return (
    <div>
      <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <DataGridTableSurface surface={surface}>
          <Table aria-label={ariaLabel} separator={surface === 'card' ? 'inset' : 'full'}>
            <TableHeader>
              <TableRow>
                {selection && (
                  <TableHead className="w-0">
                    <Checkbox
                      aria-label={t('selection.selectAll')}
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      onCheckedChange={(checked) => {
                        selection.setPage(
                          items.map((item) => [getRowId(item), item] as const),
                          checked,
                        );
                      }}
                    />
                  </TableHead>
                )}
                {columns.map((column) => {
                  const isSorted = sortDescriptor?.column === column.id;
                  const SortIcon = !isSorted
                    ? ChevronsUpDown
                    : sortDescriptor.direction === 'ascending'
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <TableHead
                      key={column.id}
                      aria-sort={
                        column.sortable ? (isSorted ? sortDescriptor.direction : 'none') : undefined
                      }
                      className={column.align === 'end' ? 'text-end' : undefined}
                    >
                      {column.sortable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-mx-2.5 font-medium"
                          onClick={() => {
                            toggleSort(column.id);
                          }}
                        >
                          {column.header}
                          <SortIcon
                            data-icon="inline-end"
                            className={isSorted ? undefined : 'text-muted-foreground'}
                          />
                        </Button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
                {rowActions && <TableHead aria-label={t('actions.menu')} className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount}>
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyDescription>{emptyMessage}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => {
                  const rowId = getRowId(item);
                  const visibleActions = rowActions?.filter(
                    (action) => action.isVisible?.(item) ?? true,
                  );
                  const isRowSelected = selection?.selectedIds.has(rowId) ?? false;
                  return (
                    <TableRow key={rowId} data-state={isRowSelected ? 'selected' : undefined}>
                      {selection && (
                        <TableCell>
                          <Checkbox
                            aria-label={t('selection.selectRow')}
                            checked={isRowSelected}
                            onCheckedChange={() => {
                              selection.toggle(rowId, item);
                            }}
                          />
                        </TableCell>
                      )}
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={
                            column.className ?? (column.align === 'end' ? 'text-end' : undefined)
                          }
                        >
                          {column.cell(item)}
                        </TableCell>
                      ))}
                      {rowActions && (
                        <TableCell className="text-end">
                          {visibleActions && visibleActions.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    aria-label={t('actions.menu')}
                                    size="icon-sm"
                                    variant="ghost"
                                  />
                                }
                              >
                                <MoreHorizontal />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-40">
                                <DropdownMenuGroup>
                                  {visibleActions.map((action) => (
                                    <DropdownMenuItem
                                      key={action.id}
                                      disabled={action.isDisabled?.(item) ?? false}
                                      variant={action.isDanger ? 'destructive' : 'default'}
                                      onClick={() => {
                                        handleRowAction(item, action);
                                      }}
                                    >
                                      {action.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </DataGridTableSurface>

        {/* Футер живе поза <table>: у shadcn таблиця — чиста розмітка, tfoot тут не при ділі */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{paginationSummary}</span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <Button
                  aria-label={t('pagination.previous')}
                  size="icon-sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => {
                    goToPage(page - 1);
                  }}
                >
                  <ChevronLeft />
                </Button>
              </PaginationItem>
              {pageItems(page, totalPages).map((item) =>
                typeof item === 'number' ? (
                  <PaginationItem key={item}>
                    <Button
                      aria-current={item === page ? 'page' : undefined}
                      size="icon-sm"
                      variant={item === page ? 'secondary' : 'ghost'}
                      onClick={() => {
                        goToPage(item);
                      }}
                    >
                      {item}
                    </Button>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <Button
                  aria-label={t('pagination.next')}
                  size="icon-sm"
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => {
                    goToPage(page + 1);
                  }}
                >
                  <ChevronRight />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          {pageSizeOptions !== false && pageSizeOptions.length > 0 && (
            <PageSizeSelect limit={limit} options={pageSizeOptions} onChange={setLimit} />
          )}
        </div>
      </div>

      {rowActions && (
        <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                {pendingAction?.action.isDanger ? (
                  <TriangleAlert className="text-destructive" />
                ) : (
                  <CircleHelp className="text-primary" />
                )}
              </AlertDialogMedia>
              <AlertDialogTitle>{pendingAction?.action.confirm?.heading}</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAction?.action.confirm?.body(pendingAction.item)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{pendingAction?.action.confirm?.cancelLabel}</AlertDialogCancel>
              <AlertDialogAction
                variant={pendingAction?.action.isDanger ? 'destructive' : 'default'}
                onClick={() => {
                  setIsConfirmOpen(false);
                  if (pendingAction) {
                    pendingAction.action.onAction(pendingAction.item);
                  }
                }}
              >
                {pendingAction?.action.confirm?.confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
