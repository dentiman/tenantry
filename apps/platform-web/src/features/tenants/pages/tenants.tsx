import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  getTenantsFindAllQueryKey,
  useTenantsFindAll,
  useTenantsUpdate,
} from '../../../api/generated/api';
import type { TenantListResponseDtoOutputItemsItem } from '../../../api/generated/model/tenantListResponseDtoOutputItemsItem';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { CreateTenantModal } from '../components/create-tenant-modal';
import { TenantIdentity } from '../components/tenant-identity';
import type { TenantsSearch } from '../tenants.routes';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';

// Типізований компаунд-набір гріда цієї сторінки; Grid.filter — фабрики фільтрів,
// привʼязані до search-схеми роуту /tenants
const Grid = createDataGrid<TenantsSearch, TenantListResponseDtoOutputItemsItem>();

/**
 * MT-3: CRUD тенантів — єдине місце в системі, де тенант створюється/suspend-иться
 * (у tenant-api під RLS це структурно неможливо). Той самий патерн, що `/users` у
 * tenant-web: `GET /tenants` тепер приймає пагінацію/пошук/фільтр (крок 1 плану),
 * тож плоска таблиця без DataGrid-фреймворку більше не єдиний варіант.
 */
export function TenantsPage() {
  const { t } = useTranslation(['tenants', 'common']);
  const queryClient = useQueryClient();
  const updateTenant = useTenantsUpdate();

  const invalidateTenants = (): void => {
    void queryClient.invalidateQueries({ queryKey: getTenantsFindAllQueryKey() });
  };

  const toggleActive = (tenant: TenantListResponseDtoOutputItemsItem): void => {
    updateTenant.mutate(
      { id: tenant.id, data: { isActive: !tenant.isActive } },
      { onSuccess: invalidateTenants },
    );
  };

  const filters: DataGridFilterDef<TenantsSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    Grid.filter.select({
      key: 'isActive',
      ariaLabel: t('filters.statusLabel'),
      allLabel: t('filters.statusAll'),
      options: [
        { id: 'true', label: t('status.active') },
        { id: 'false', label: t('status.suspended') },
      ],
    }),
  ];

  const columns: DataGridColumn<TenantListResponseDtoOutputItemsItem>[] = [
    {
      id: 'name',
      header: t('table.name'),
      isRowHeader: true,
      sortable: true,
      className: 'max-w-[18rem]',
      cell: (tenant) => (
        <Link
          to="/tenants/$tenantId"
          params={{ tenantId: tenant.id }}
          className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TenantIdentity id={tenant.id} name={tenant.name} slug={tenant.slug} />
        </Link>
      ),
    },
    {
      id: 'isActive',
      header: t('table.status'),
      sortable: true,
      cell: (tenant) => (
        <Badge variant={tenant.isActive ? 'success' : 'destructive'}>
          {tenant.isActive ? t('status.active') : t('status.suspended')}
        </Badge>
      ),
    },
    {
      id: 'locale',
      header: t('table.locale'),
      cell: (tenant) => tenant.locale,
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (tenant) => <DateTimeCell value={tenant.createdAt} />,
    },
  ];

  const rowActions: DataGridRowAction<TenantListResponseDtoOutputItemsItem>[] = [
    {
      id: 'suspend',
      label: t('actions.suspend'),
      isDanger: true,
      isVisible: (tenant) => tenant.isActive,
      onAction: toggleActive,
      confirm: {
        heading: t('actions.suspendConfirm.heading'),
        body: (tenant) => (
          <Trans t={t} i18nKey="actions.suspendConfirm.body" values={{ name: tenant.name }} />
        ),
        confirmLabel: t('actions.suspendConfirm.confirmLabel'),
        cancelLabel: t('actions.suspendConfirm.cancelLabel'),
      },
    },
    {
      id: 'resume',
      label: t('actions.resume'),
      isVisible: (tenant) => !tenant.isActive,
      onAction: toggleActive,
      confirm: {
        heading: t('actions.resumeConfirm.heading'),
        body: (tenant) => (
          <Trans t={t} i18nKey="actions.resumeConfirm.body" values={{ name: tenant.name }} />
        ),
        confirmLabel: t('actions.resumeConfirm.confirmLabel'),
        cancelLabel: t('actions.resumeConfirm.cancelLabel'),
      },
    },
  ];

  return (
    // limit не шлемо — дефолт задає бекенд (PaginationQuerySchema, 20)
    // selection НЕ вмикаємо: bulk-ендпоінта немає
    <Grid.Root
      useListQuery={(params, gridOptions) => useTenantsFindAll(params, { query: gridOptions })}
    >
      <PageHeader
        label="TenantsPage"
        breadcrumbs={[{ label: t('title') }]}
        subtitle={t('subtitle')}
        actions={<CreateTenantModal />}
      />

      <div className="border-b border-border">
        <Grid.Toolbar
          surface="band"
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
        isRowMuted={(tenant) => !tenant.isActive}
        surface="flush"
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />
    </Grid.Root>
  );
}
