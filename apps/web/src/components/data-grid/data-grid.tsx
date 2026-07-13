import { useState } from 'react';
import { AlertDialog, Button, Dropdown, EmptyState, Label, Pagination, Spinner, Table } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { pageItems } from '../../lib/page-items';
import type { DataGridQueryResult } from './data-grid-query';
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

  messages?: DataGridMessages;
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
  messages,
}: DataGridProps<T>) {
  const { page, sortDescriptor, onSortChange, goToPage } = grid;
  const { items, total, totalPages, isLoading, isPlaceholderData } = list;
  const { t } = useTranslation('common');
  const loadingLabel = messages?.loading ?? t('loading');
  const emptyMessage = messages?.empty ?? t('empty');
  const paginationSummary = t('pagination.summary', { total, page, totalPages });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: DataGridRowAction<T>;
    item: T;
  } | null>(null);

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
    <div>
      <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label={ariaLabel}
              sortDescriptor={sortDescriptor}
              onSortChange={onSortChange}
            >
              <Table.Header>
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
