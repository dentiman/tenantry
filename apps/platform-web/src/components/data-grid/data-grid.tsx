import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertDialog,
  Button,
  Checkbox,
  Dropdown,
  EmptyState,
  Label,
  ListBox,
  Pagination,
  Select,
  Spinner,
  Table,
} from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { pageItems } from '../../lib/page-items';
import type { DataGridQueryResult } from './data-grid-query';
import type { DataGridSelectionState } from './use-data-grid-selection';
import { DEFAULT_PAGE_SIZE_OPTIONS } from './types';
import type { DataGridColumn, DataGridMessages, DataGridNavigation, DataGridRowAction } from './types';

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

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
}

/**
 * Чекбокс вибору: візуал — компаундний HeroUI Checkbox (як у доках компонента),
 * взаємодія — власний прозорий нативний <input> поверх нього. Причина: у HeroUI v3
 * beta (3.2.x) прес по чекбоксу всередині таблиці не перемикає стан (перевірено),
 * тому HeroUI-частина інертна (лише малює isSelected/isIndeterminate), а клік,
 * клавіатура, фокус і a11y йдуть через нативний інпут. Клік по рядку не обирає.
 */
function SelectionCheckbox({
  label,
  isSelected,
  isIndeterminate = false,
  onChange,
  isRow,
}: {
  label: string;
  isSelected: boolean;
  isIndeterminate?: boolean;
  onChange: (isSelected: boolean) => void;
  isRow?: boolean;
}) {
  return (
    <span className="relative inline-flex rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
      {/* inert: візуал не потрапляє ні в таб-ордер, ні в дерево доступності */}
      <span inert>
        <Checkbox
          aria-label={label}
          // slot={null} відв'язує від CheckboxContext таблиці (інакше RAC вимагає slot="selection")
          slot={null}
          isSelected={isSelected}
          isIndeterminate={isIndeterminate}
          variant={isRow ? 'secondary' : undefined}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={isSelected}
        ref={(el) => {
          // indeterminate виставляється лише через DOM-властивість, атрибута немає
          if (el) el.indeterminate = isIndeterminate;
        }}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/** Селект «Items per page» у футері; той самий компаунд Select, що й фільтри тулбара */
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
  const items = options.includes(limit) ? options : [...options, limit].sort((a, b) => a - b);
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-sm text-muted">{t('pagination.perPage')}</span>
      <Select
        aria-label={t('pagination.perPage')}
        variant="secondary"
        className="w-24"
        value={String(limit)}
        onChange={(key) => {
          onChange(Number(String(key)));
        }}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {items.map((option) => (
              <ListBox.Item key={option} id={String(option)} textValue={String(option)}>
                {option}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
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

  // Хедер-чекбокс рендериться ПОРТАЛОМ у <th>: вміст колонок React Aria кешує
  // в колекції (пропси/замикання там застигають на старих рендерах), а портальний
  // вузол живе поза колекцією і оновлюється звичайним React-рендером DataGrid.
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectAllCell, setSelectAllCell] = useState<HTMLElement | null>(null);
  const hasSelection = selection !== undefined;
  useEffect(() => {
    if (!hasSelection || isLoading) {
      setSelectAllCell(null);
      return;
    }
    const find = (): void => {
      // setState з тим самим елементом не спричиняє повторний рендер
      setSelectAllCell(rootRef.current?.querySelector<HTMLElement>('thead th') ?? null);
    };
    find();
    // RAC монтує видиму таблицю окремим комітом після побудови колекції
    const timer = setTimeout(find, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [hasSelection, isLoading, items]);

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

  return (
    <div ref={rootRef}>
      {selection &&
        selectAllCell &&
        createPortal(
          <SelectionCheckbox
            label={t('selection.selectAll')}
            isSelected={allPageSelected}
            isIndeterminate={somePageSelected}
            onChange={(isSelected) => {
              selection.setPage(
                items.map((item) => [getRowId(item), item] as const),
                isSelected,
              );
            }}
          />,
          selectAllCell,
        )}
      <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label={ariaLabel}
              sortDescriptor={sortDescriptor}
              onSortChange={onSortChange}
            >
              <Table.Header>
                {selection && (
                  /* вміст приходить порталом (selectAllCell) — див. коментар вище */
                  <Table.Column aria-label={t('selection.selectAll')} className="pr-0">
                    {' '}
                  </Table.Column>
                )}
                {columns.map((column) => (
                  <Table.Column
                    key={column.id}
                    id={column.id}
                    isRowHeader={column.isRowHeader}
                    allowsSorting={column.sortable}
                    className={column.align === 'end' ? 'text-end' : undefined}
                  >
                    {column.sortable
                      ? ({ sortDirection }) => (
                          <Table.SortableColumnHeader sortDirection={sortDirection}>
                            {column.header}
                          </Table.SortableColumnHeader>
                        )
                      : column.header}
                  </Table.Column>
                ))}
                {rowActions && <Table.Column aria-label={t('actions.menu')}> </Table.Column>}
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <EmptyState className="flex h-full w-full flex-col items-center justify-center gap-2 py-6 text-center">
                    <span className="text-sm text-muted">{emptyMessage}</span>
                  </EmptyState>
                )}
              >
                {items.map((item) => {
                  const rowId = getRowId(item);
                  const visibleActions = rowActions?.filter((action) => action.isVisible?.(item) ?? true);
                  return (
                    <Table.Row key={rowId} id={rowId}>
                      {selection && (
                        <Table.Cell className="pr-0">
                          <SelectionCheckbox
                            label={t('selection.selectRow')}
                            isSelected={selection.selectedIds.has(rowId)}
                            onChange={() => {
                              selection.toggle(rowId, item);
                            }}
                            isRow
                          />
                        </Table.Cell>
                      )}
                      {columns.map((column) => (
                        <Table.Cell
                          key={column.id}
                          className={column.className ?? (column.align === 'end' ? 'text-end' : undefined)}
                        >
                          {column.cell(item)}
                        </Table.Cell>
                      ))}
                      {rowActions && (
                        <Table.Cell className="text-end">
                          {visibleActions && visibleActions.length > 0 && (
                            <Dropdown>
                              <Button aria-label={t('actions.menu')} isIconOnly size="sm" variant="ghost">
                                <MoreIcon />
                              </Button>
                              <Dropdown.Popover placement="bottom end">
                                <Dropdown.Menu
                                  onAction={(key) => {
                                    const action = visibleActions.find((a) => a.id === key);
                                    if (action) {
                                      handleRowAction(item, action);
                                    }
                                  }}
                                >
                                  {visibleActions.map((action) => (
                                    <Dropdown.Item
                                      key={action.id}
                                      id={action.id}
                                      textValue={action.label}
                                      isDisabled={action.isDisabled?.(item) ?? false}
                                      variant={action.isDanger ? 'danger' : undefined}
                                    >
                                      <Label>{action.label}</Label>
                                    </Dropdown.Item>
                                  ))}
                                </Dropdown.Menu>
                              </Dropdown.Popover>
                            </Dropdown>
                          )}
                        </Table.Cell>
                      )}
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer>
            <Pagination>
              <Pagination.Summary>{paginationSummary}</Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={page <= 1}
                    onPress={() => {
                      goToPage(page - 1);
                    }}
                  >
                    <Pagination.PreviousIcon />
                  </Pagination.Previous>
                </Pagination.Item>
                {pageItems(page, totalPages).map((item) =>
                  typeof item === 'number' ? (
                    <Pagination.Item key={item}>
                      <Pagination.Link
                        isActive={item === page}
                        onPress={() => {
                          goToPage(item);
                        }}
                      >
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={item}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ),
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page >= totalPages}
                    onPress={() => {
                      goToPage(page + 1);
                    }}
                  >
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
              {pageSizeOptions !== false && pageSizeOptions.length > 0 && (
                <PageSizeSelect limit={limit} options={pageSizeOptions} onChange={setLimit} />
              )}
            </Pagination>
          </Table.Footer>
        </Table>
      </div>

      {rowActions && (
        <AlertDialog.Backdrop
          isOpen={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
        >
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[400px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status={pendingAction?.action.isDanger ? 'danger' : 'accent'} />
                <AlertDialog.Heading>{pendingAction?.action.confirm?.heading}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {pendingAction?.action.confirm?.body(pendingAction.item)}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  {pendingAction?.action.confirm?.cancelLabel}
                </Button>
                <Button
                  slot="close"
                  variant={pendingAction?.action.isDanger ? 'danger' : 'primary'}
                  onPress={() => {
                    if (pendingAction) {
                      pendingAction.action.onAction(pendingAction.item);
                    }
                  }}
                >
                  {pendingAction?.action.confirm?.confirmLabel}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      )}
    </div>
  );
}
