import { useState } from 'react';
import { Avatar, Chip } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getUsersFindAllQueryKey, useUsersFindAll, useUsersRemove } from '../api/generated/api';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { useAuthStore } from '../stores/auth.store';
import { ChangeAvatarModal } from '../components/change-avatar-modal';
import { CreateUserModal } from '../components/create-user-modal';
import { ActivityDrawer } from '../components/activity/activity-drawer';
import { PresenceDot } from '../components/presence-dot';
import { usePresence } from '../realtime/use-presence';
import { formatDate } from '../lib/format';
import { CountryFlag } from '../components/form/phone/country-flag';
import { isSupportedCountry } from '../components/form/phone/countries';
import { formatForDisplay } from '../components/form/phone/phone-format';
import type { UsersSearch } from '../router';
import { createDataGrid } from '../components/data-grid';
import type { DataGridColumn, DataGridFilterDef, DataGridRowAction } from '../components/data-grid';

// Типізований компаунд-набір гріда цієї сторінки; Grid.filter — фабрики фільтрів,
// привʼязані до search-схеми роуту /users
const Grid = createDataGrid<UsersSearch, UserListResponseDtoOutputItemsItem>();

/** Бізнес-фільтр статусу юзера: Active/Inactive ↔ isActive=true/false в URL і query API */
function userStatusFilter(t: TFunction<['users', 'common']>): DataGridFilterDef<UsersSearch> {
  return Grid.filter.select({
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
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  // Presence — окремий запит: він НЕ залежить від пагінації користувачів і не
  // інвалідується разом із нею (склад сторінки змінюється частіше за присутність)
  const presence = usePresence();
  // Юзер, якому міняємо аватар (демо файлової підсистеми); null — модалка закрита
  const [avatarUser, setAvatarUser] = useState<UserListResponseDtoOutputItemsItem | null>(null);
  // Юзер, чий фід активностей відкрито в драйвері; null — драйвер закрито
  const [activityUser, setActivityUser] = useState<UserListResponseDtoOutputItemsItem | null>(null);

  const invalidateUsers = (): void => {
    void queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
  };

  const removeUser = useUsersRemove({
    mutation: { onSuccess: invalidateUsers },
  });

  // Тулбар декларується так само, як columns: масив дефініцій
  const filters: DataGridFilterDef<UsersSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    userStatusFilter(t),
  ];

  const columns: DataGridColumn<UserListResponseDtoOutputItemsItem>[] = [
    {
      id: 'avatar',
      header: t('table.avatar'),
      cell: (u) => (
        <span className="relative inline-flex">
          <Avatar size="sm">
            {u.avatarUrl && <Avatar.Image alt={u.email} src={u.avatarUrl} />}
            <Avatar.Fallback>{(u.name ?? u.email).slice(0, 2).toUpperCase()}</Avatar.Fallback>
          </Avatar>
          <PresenceDot
            isOnline={presence.isOnline(u.id)}
            isUnknown={presence.isUnknown}
            labels={{ online: t('presence.online'), offline: t('presence.offline') }}
          />
        </span>
      ),
    },
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
      id: 'phone',
      header: t('table.phone'),
      cell: (u) => {
        const formatted = formatForDisplay(u.phone);
        if (!formatted) return '—';
        return (
          <span className="flex items-center gap-2 tabular-nums">
            {isSupportedCountry(u.phoneCountry) && <CountryFlag country={u.phoneCountry} />}
            {formatted}
          </span>
        );
      },
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
      id: 'activity',
      label: t('activity.action'),
      onAction: (u) => {
        setActivityUser(u);
      },
    },
    {
      id: 'avatar',
      label: t('avatar.action'),
      onAction: (u) => {
        setAvatarUser(u);
      },
    },
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
    // limit не шлемо — дефолт задає бекенд (PaginationQuerySchema, 20)
    <Grid.Root
      useListQuery={(params, gridOptions) => useUsersFindAll(params, { query: gridOptions })}
      selection
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Grid.Filters filters={filters} />
          <CreateUserModal />
        </div>
      </div>

      <Grid.SelectionSummary />

      <Grid.Table
        ariaLabel={t('table.ariaLabel')}
        columns={columns}
        rowActions={rowActions}
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />

      <ChangeAvatarModal
        user={avatarUser}
        onClose={() => {
          setAvatarUser(null);
        }}
      />

      <ActivityDrawer
        entityType="user"
        entityId={activityUser?.id ?? null}
        subtitle={activityUser?.email}
        onClose={() => {
          setActivityUser(null);
        }}
      />
    </Grid.Root>
  );
}
