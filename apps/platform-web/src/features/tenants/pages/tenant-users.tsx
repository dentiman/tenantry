import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  getTenantUsersFindAllQueryKey,
  useTenantUsersFindAll,
  useTenantUsersRevokeSessions,
  useTenantUsersSetStatus,
} from '../../../api/generated/api';
import type { TenantUserListResponseDtoOutputItemsItem } from '../../../api/generated/model/tenantUserListResponseDtoOutputItemsItem';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Card } from '@saas-skeleton/ui/components/ui/card';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';
import { TenantUserPasswordModal } from '../components/tenant-user-password-modal';
import type { TenantUsersSearch } from '../tenants.routes';

type Item = TenantUserListResponseDtoOutputItemsItem;

const Grid = createDataGrid<TenantUsersSearch, Item>();

/**
 * Аварійне керування юзерами tenant-а: урізана версія `/users` із tenant-web. Лише дії,
 * потрібні оператору, коли tenant-адмін не може допомогти собі сам (забутий пароль
 * єдиного адміна): новий пароль, вихід звідусіль, вимкнути/увімкнути. Усе пишеться
 * в журнал платформи, а tenant-адмін бачить дію в стрічці юзера від імені `system`.
 */
export function TenantUsersPage() {
  const { t } = useTranslation('tenant-users');
  const { tenantId } = useParams({ from: '/app/tenants/$tenantId/users' });
  const queryClient = useQueryClient();
  const [passwordUser, setPasswordUser] = useState<Item | null>(null);

  const setStatus = useTenantUsersSetStatus({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getTenantUsersFindAllQueryKey(tenantId) });
      },
    },
  });
  const revokeSessions = useTenantUsersRevokeSessions({
    mutation: {
      onSuccess: ({ revokedCount }) => {
        toast.add({
          type: 'success',
          title: t('actions.revoked', { count: revokedCount }),
        });
      },
    },
  });

  const nameOf = (u: Item): string => {
    const name = u.name?.trim();
    return name === undefined || name === '' ? u.email : name;
  };

  const filters: DataGridFilterDef<TenantUsersSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    Grid.filter.select({
      key: 'isActive',
      ariaLabel: t('filters.statusLabel'),
      allLabel: t('filters.statusAll'),
      options: [
        { id: 'true', label: t('status.active') },
        { id: 'false', label: t('status.disabled') },
      ],
    }),
  ];

  const columns: DataGridColumn<Item>[] = [
    {
      id: 'email',
      header: t('table.user'),
      isRowHeader: true,
      sortable: true,
      className: 'max-w-[22rem]',
      cell: (u) => <UserIdentity id={u.id} email={u.email} name={u.name} />,
    },
    {
      id: 'role',
      header: t('table.role'),
      sortable: true,
      cell: (u) => (
        <Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>{t(`roles.${u.role}`)}</Badge>
      ),
    },
    {
      id: 'isActive',
      header: t('table.status'),
      sortable: true,
      cell: (u) => (
        <Badge variant={u.isActive ? 'success' : 'destructive'}>
          {u.isActive ? t('status.active') : t('status.disabled')}
        </Badge>
      ),
    },
    {
      id: 'lastSeen',
      header: t('table.lastSeen'),
      cell: (u) =>
        u.lastSeenAt ? (
          <DateTimeCell value={u.lastSeenAt} />
        ) : (
          <span className="text-muted-foreground">{t('neverSeen')}</span>
        ),
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (u) => <DateTimeCell value={u.createdAt} />,
    },
  ];

  const confirmFor = (key: 'revokeConfirm' | 'disableConfirm' | 'enableConfirm') => ({
    heading: t(`actions.${key}.heading`),
    body: (u: Item) => <Trans t={t} i18nKey={`actions.${key}.body`} values={{ name: nameOf(u) }} />,
    confirmLabel: t(`actions.${key}.confirmLabel`),
    cancelLabel: t(`actions.${key}.cancelLabel`),
  });

  const rowActions: DataGridRowAction<Item>[] = [
    {
      id: 'setPassword',
      label: t('actions.setPassword'),
      onAction: (u) => {
        setPasswordUser(u);
      },
    },
    {
      id: 'revokeSessions',
      label: t('actions.revokeSessions'),
      onAction: (u) => {
        revokeSessions.mutate({ tenantId, userId: u.id });
      },
      confirm: confirmFor('revokeConfirm'),
    },
    {
      id: 'disable',
      label: t('actions.disable'),
      isDanger: true,
      isVisible: (u) => u.isActive,
      onAction: (u) => {
        setStatus.mutate({ tenantId, userId: u.id, data: { isActive: false } });
      },
      confirm: confirmFor('disableConfirm'),
    },
    {
      id: 'enable',
      label: t('actions.enable'),
      isVisible: (u) => !u.isActive,
      onAction: (u) => {
        setStatus.mutate({ tenantId, userId: u.id, data: { isActive: true } });
      },
      confirm: confirmFor('enableConfirm'),
    },
  ];

  return (
    <Grid.Root
      useListQuery={(params, gridOptions) =>
        useTenantUsersFindAll(tenantId, params, { query: gridOptions })
      }
    >
      {/* Тулбар і таблиця — одна картка: смуга фільтрів зверху, таблиця з футером під нею,
          без стику між ними (flush — таблиця без власної рамки, рамка — у картки) */}
      <Card size="sm" className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border">
          <Grid.Toolbar
            surface="band"
            className="bg-transparent"
            filters={filters}
            totalLabel={t('toolbar.total')}
            selectedLabel={t('toolbar.selected')}
            size="sm"
          />
        </div>

        <Grid.Table
          ariaLabel={t('table.ariaLabel')}
          columns={columns}
          rowActions={rowActions}
          isRowMuted={(u) => !u.isActive}
          surface="flush"
          messages={{ loading: t('loadingLabel'), empty: t('empty') }}
        />
      </Card>

      <TenantUserPasswordModal
        tenantId={tenantId}
        user={passwordUser}
        onClose={() => {
          setPasswordUser(null);
        }}
      />
    </Grid.Root>
  );
}
