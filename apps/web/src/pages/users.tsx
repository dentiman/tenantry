import { Button, Chip } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getUsersFindAllQueryKey, useUsersFindAll, useUsersRemove } from '../api/generated/api';
import type { UsersFindAllParams } from '../api/generated/model';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { useAuthStore } from '../stores/auth.store';
import { CreateUserModal } from '../components/create-user-modal';
import { formatDate } from '../lib/format';
import type { UsersSearch } from '../router';
import {
  DataGrid,
  DataGridFilters,
  defineFilters,
  gridQueryOptions,
  toGridQueryResult,
  useDataGridFilters,
  useDataGridSelection,
} from '../components/data-grid';
import type { DataGridColumn, DataGridFilterDef, DataGridRowAction } from '../components/data-grid';

// Фабрики фільтрів, привʼязані до search-схеми роуту /users
const filter = defineFilters<UsersSearch>();

/** Бізнес-фільтр статусу юзера: Active/Inactive ↔ isActive=true/false в URL і query API */
function userStatusFilter(t: TFunction<['users', 'common']>): DataGridFilterDef<UsersSearch> {
  return filter.select({
    key: 'isActive',
    ariaLabel: t('filters.statusLabel'),
    allLabel: t('filters.statusAll'),
    options: [
      { id: 'true', label: t('status.active') },
      { id: 'false', label: t('status.inactive') },
    ],
  });
}

export function UsersPage() {
  const { t } = useTranslation(['users', 'common']);
  // Фільтри живуть у search-параметрах роуту (дефолт хука) — роутер усередині
  const grid = useDataGridFilters<UsersSearch>();
  // Вибір типізований рядком гріда: назовні виходять цілі обрані юзери, не лише id
  const selection = useDataGridSelection<UserListResponseDtoOutputItemsItem>();
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // limit не шлемо — дефолт задає бекенд (PaginationQuerySchema, 20)
  const params: UsersFindAllParams = { ...grid.filters, page: grid.page };
  const list = toGridQueryResult(useUsersFindAll(params, { query: gridQueryOptions }));

  const invalidateUsers = (): void => {
    void queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
  };

  const removeUser = useUsersRemove({
    mutation: { onSuccess: invalidateUsers },
  });

  // Тулбар декларується так само, як columns: масив дефініцій
  const filters: DataGridFilterDef<UsersSearch>[] = [
    filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    userStatusFilter(t),
  ];

  const columns: DataGridColumn<UserListResponseDtoOutputItemsItem>[] = [
    {
      id: 'email',
      header: t('table.email'),
      isRowHeader: true,
      sortable: true,
      className: 'font-medium text-foreground',
      cell: (u) => u.email,
    },
    {
      id: 'name',
      header: t('table.name'),
      sortable: true,
      cell: (u) => u.name ?? '—',
    },
    {
      id: 'role',
      header: t('table.role'),
      sortable: true,
      cell: (u) => (
        <Chip size="sm" color={u.role === 'ADMIN' ? 'accent' : 'default'}>
          {t(`roles.${u.role}`)}
        </Chip>
      ),
    },
    {
      id: 'isActive',
      header: t('table.active'),
      sortable: true,
      cell: (u) => (
        <Chip size="sm" color={u.isActive ? 'success' : 'danger'}>
          {u.isActive ? t('status.active') : t('status.inactive')}
        </Chip>
      ),
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (u) => formatDate(u.createdAt),
    },
  ];

  const rowActions: DataGridRowAction<UserListResponseDtoOutputItemsItem>[] = [
    {
      id: 'delete',
      label: t('delete.button'),
      isDanger: true,
      // Себе видалити не можна: пункт видно, але він неактивний
      isDisabled: (u) => u.id === currentUser?.id,
      onAction: (u) => {
        removeUser.mutate({ id: u.id });
      },
      confirm: {
        heading: t('delete.heading'),
        body: (u) => (
          <p>
            <Trans
              t={t}
              i18nKey="delete.body"
              values={{ email: u.email }}
              components={{ strong: <strong /> }}
            />
          </p>
        ),
        confirmLabel: t('delete.confirm'),
        cancelLabel: t('delete.cancel'),
      },
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <DataGridFilters grid={grid} filters={filters} />
          <CreateUserModal />
        </div>
      </div>

      {selection.selectedItems.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-muted">
            {t('common:selection.summary', { count: selection.selectedItems.length })}
          </span>
          <Button size="sm" variant="ghost" onPress={selection.clear}>
            {t('common:selection.clear')}
          </Button>
        </div>
      )}

      <DataGrid
        ariaLabel={t('table.ariaLabel')}
        columns={columns}
        rowActions={rowActions}
        grid={grid}
        list={list}
        selection={selection}
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />
    </div>
  );
}
