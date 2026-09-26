import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { cn } from '../../lib/utils';
import { pageItems } from '../../lib/page-items';
import { useSortableReorder } from '../../hooks/use-sortable-reorder';
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
  /**
   * Вміст хедер-комірки колонки дій (напр. шестерня колонок). Задає колонку дій і
   * без rowActions — тоді комірки рядків у ній порожні, але шестерні є де стояти
   */
  actionsHeader?: ReactNode;
  /**
   * Перетягування заголовків колонок (порядок полів). Колонки вибору й дій у ньому не
   * беруть участі; закріплені (`lockedIds`) стоять першими й не тягнуться. Без пропа
   * заголовки статичні.
   */
  reorder?: {
    lockedIds: string[];
    onMove: (columnId: string, beforeId: string | null) => void;
  };
  /** За замовчуванням — item.id (усі сутності мають uuid id); переозначити для інших ключів */
  getRowId?: (item: T) => string;
  /**
   * Рядок «вимкненої» сутності (неактивний юзер, архівований кастомер) — приглушується
   * ЦІЛКОМ, а не окремою колонкою статусу: стан належить запису, і око має ловити його
   * розгорткою всього списку, не читаючи бейдж у кожному рядку.
   *
   * Приглушення — прозорість, а не колір: у рядку є і текст, і бейджі, і перемикач, і в
   * кожного власна палітра; `text-muted-foreground` подіяв би тільки на текст, а
   * `opacity` однаково відводить назад усе, що в комірці намальовано.
   *
   * Службові колонки (чекбокс вибору і меню дій) лишаються при повній непрозорості:
   * приглушується ЗМІСТ запису, а керування ним — ні, інакше «повернути в роботу»
   * доводилось би шукати оком серед блідого. Технічно це й неможливо інакше: `opacity`
   * на `<tr>` перемножується на дітей, і повернути окремій комірці повний тон не вийде.
   */
  isRowMuted?: (item: T) => boolean;

  /** Сортування й пагінація — з useDataGridFilters(); URL-синхронізація опціональна там */
  grid: DataGridNavigation;
  /** Дані й стан фетчингу — з toGridQueryResult(); DataGrid сам нічого не запитує */
  list: DataGridQueryResult<T>;

  /** Мультивибір рядків — з useDataGridSelection(); без пропа чекбоксів немає */
  selection?: DataGridSelectionState<T>;

  /** Варіанти «Items per page» у футері; false — прибрати селект зовсім */
  pageSizeOptions?: number[] | false;

  messages?: DataGridMessages;
  /**
   * bordered — legacy wrapper; card — таблиця на `Card` з inset-розділювачами;
   * flush — БЕЗ поверхні взагалі: таблиця сама є полотном сторінки (роут у
   * режимі `bleed`) і впирається в краї вікна.
   */
  surface?: DataGridSurface;
}

export type DataGridSurface = 'bordered' | 'card' | 'flush';

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

  if (surface === 'flush') {
    // Ні рамки, ні фону — але крайні комірки отримують поле шела (24px), інакше
    // текст першої колонки читався б приклеєним до краю вікна, а вміст таблиці
    // розʼїхався б із крихтами хедера, які стоять рівно на цій вертикалі
    return <div className="[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-6">{children}</div>;
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
  actionsHeader,
  reorder,
  getRowId = (item) => item.id,
  isRowMuted,
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
  const hasActionsColumn = rowActions !== undefined || actionsHeader !== undefined;
  // Рахується з РЕАЛЬНО відрендерених колонок — colSpan empty-стану йде за схованими
  const columnCount = columns.length + (selection ? 1 : 0) + (hasActionsColumn ? 1 : 0);

  // Drop-режим: колонки НЕ зсуваються під рукою (це рухало б кожну клітинку кожного
  // рядка й підкидало ціль під вказівником) — лише привид і лінія вставки, порядок
  // застосовується на відпусканні. Rules of Hooks: викликається й без `reorder`
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { drag, itemRef, handleProps, getElement } = useSortableReorder({
    axis: 'x',
    ids: reorder ? columns.map((column) => column.id) : [],
    lockedIds: reorder?.lockedIds ?? [],
    enabled: reorder !== undefined,
    mode: 'drop',
    onMove: (columnId, beforeId) => {
      reorder?.onMove(columnId, beforeId);
    },
    scrollContainer: () =>
      surfaceRef.current?.querySelector<HTMLElement>('[data-slot=table-container]') ?? null,
  });

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

  /**
   * Лінія вставки (2px primary на всю висоту таблиці, як в Airtable) і привид
   * заголовка під вказівником. Позиції читаються з DOM у рендері, спричиненому
   * рухом вказівника, — окремого стану під них не треба.
   */
  function renderDragOverlay(): ReactNode {
    const surfaceNode = surfaceRef.current;
    const dragged = drag ? getElement(drag.id) : undefined;
    const container = surfaceNode?.querySelector<HTMLElement>('[data-slot=table-container]');
    if (!drag || !surfaceNode || !dragged || !container) {
      return null;
    }
    const draggedIndex = columns.findIndex((column) => column.id === drag.id);
    const draggedColumn = columns[draggedIndex];
    const lastColumn = columns.at(-1);
    // Ціль «туди ж, де стоїть» — лінію не показуємо: відпускання нічого не змінить
    const isNoop = drag.beforeId === (columns[draggedIndex + 1]?.id ?? null);
    const anchor = drag.beforeId
      ? getElement(drag.beforeId)
      : lastColumn && getElement(lastColumn.id);
    const surfaceBox = surfaceNode.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const draggedBox = dragged.getBoundingClientRect();
    let line: ReactNode = null;
    if (!isNoop && anchor) {
      const anchorBox = anchor.getBoundingClientRect();
      const edge = drag.beforeId ? anchorBox.left : anchorBox.right;
      // Не виходить за видиму частину прокручуваної таблиці
      const x = Math.min(Math.max(edge, containerBox.left), containerBox.right - 2);
      line = (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 w-0.5 -translate-x-1/2 rounded-full bg-primary"
          style={{
            left: x - surfaceBox.left,
            top: containerBox.top - surfaceBox.top,
            height: containerBox.height,
          }}
        />
      );
    }
    const ghost = createPortal(
      <div
        aria-hidden
        className="pointer-events-none fixed z-50 flex items-center rounded-md bg-popover px-2 text-sm font-medium text-popover-foreground opacity-90 shadow-md ring-1 ring-foreground/10"
        style={{
          left: drag.pointerX - drag.offsetX,
          top: draggedBox.top,
          width: draggedBox.width,
          height: draggedBox.height,
        }}
      >
        <span className="truncate">{draggedColumn?.header}</span>
      </div>,
      document.body,
    );
    return (
      <>
        {line}
        {ghost}
      </>
    );
  }

  /** Той самий цикл, що давав React Aria: та сама колонка → зміна напряму, інша → ascending */
  const toggleSort = (columnId: string): void => {
    const isCurrent = sortDescriptor?.column === columnId;
    onSortChange({
      column: columnId,
      direction: isCurrent && sortDescriptor.direction === 'ascending' ? 'descending' : 'ascending',
    });
  };

  const dragOverlay = renderDragOverlay();

  return (
    <div>
      <div
        ref={surfaceRef}
        className={cn(
          'relative',
          isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity',
        )}
      >
        {dragOverlay}
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
                  const isDraggable =
                    reorder !== undefined && !reorder.lockedIds.includes(column.id);
                  return (
                    <TableHead
                      key={column.id}
                      ref={reorder ? itemRef(column.id) : undefined}
                      aria-sort={
                        column.sortable ? (isSorted ? sortDescriptor.direction : 'none') : undefined
                      }
                      className={cn(
                        column.align === 'end' && 'text-end',
                        isDraggable && 'cursor-grab',
                        // Колонка «в руці» лишається на місці напівпрозорою — видно, звідки її взяли
                        drag?.id === column.id && 'opacity-40',
                      )}
                      onPointerDown={(event) => {
                        // Лише миша/перо: на дотику жест по заголовку — це прокрутка
                        // таблиці, а порядок там міняють у меню полів
                        if (isDraggable && event.pointerType !== 'touch') {
                          handleProps(column.id).onPointerDown(event);
                        }
                      }}
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
                {hasActionsColumn && (
                  <TableHead
                    aria-label={actionsHeader === undefined ? t('actions.menu') : undefined}
                    className="w-0 text-end"
                  >
                    {actionsHeader}
                  </TableHead>
                )}
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
                  const isMuted = isRowMuted?.(item) ?? false;
                  return (
                    <TableRow
                      key={rowId}
                      data-state={isRowSelected ? 'selected' : undefined}
                      data-muted={isMuted ? '' : undefined}
                    >
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
                          className={cn(
                            column.className ?? (column.align === 'end' ? 'text-end' : undefined),
                            // 65%: перше значення (75%) на темному полотні майже не
                            // читалось — muted-текст і так світліший за foreground, і
                            // чверть прозорості на ньому губиться. Рядок лишається
                            // розбірливим (це не disabled-контрол, дані в ньому справжні),
                            // але в розгортці списку явно відходить на другий план
                            isMuted && 'opacity-65',
                          )}
                        >
                          {column.cell(item)}
                        </TableCell>
                      ))}
                      {hasActionsColumn && (
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
        <div
          className={cn(
            'mt-3 flex flex-wrap items-center justify-between gap-3',
            // У flush поля роздає сам грід — контейнер сторінки їх не має
            surface === 'flush' && 'px-6 pb-6',
          )}
        >
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
