import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  getCustomersFindAllQueryKey,
  useCustomersFindAll,
  useCustomersRemove,
  useCustomersSetStatus,
} from '../api/generated/api';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import type { CustomerListResponseDtoOutputItemsItem } from '../api/generated/model/customerListResponseDtoOutputItemsItem';
import { CreateCustomerModal } from '../components/create-customer-modal';
import { CustomerIdentity } from '../components/customer-identity';
import { formatDate } from '@saas-skeleton/ui/lib/format';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import type { CustomersSearch } from '../router';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';

type Customer = CustomerListResponseDtoOutputItemsItem;

const Grid = createDataGrid<CustomersSearch, Customer>();

/** Badge статусу: активний — нейтральний, неактивний і архів — приглушені */
function StatusBadge({ status, label }: { status: Customer['status']; label: string }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'INACTIVE' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{label}</Badge>;
}

function statusFilter(t: TFunction<['customers']>): DataGridFilterDef<CustomersSearch> {
  return Grid.filter.select({
    key: 'status',
    ariaLabel: t('filters.statusLabel'),
    allLabel: t('filters.statusAll'),
    options: [
      { id: 'ACTIVE', label: t('status.ACTIVE') },
      { id: 'INACTIVE', label: t('status.INACTIVE') },
      // Архівні свідомо доступні лише явним вибором: за замовчуванням список їх
      // ховає (бекенд робить те саме) — у цьому й сенс архіву
      { id: 'ARCHIVED', label: t('status.ARCHIVED') },
    ],
  });
}

function kindFilter(t: TFunction<['customers']>): DataGridFilterDef<CustomersSearch> {
  return Grid.filter.select({
    key: 'kind',
    ariaLabel: t('filters.kindLabel'),
    allLabel: t('filters.kindAll'),
    options: [
      { id: 'ORGANIZATION', label: t('kind.ORGANIZATION') },
      { id: 'PERSON', label: t('kind.PERSON') },
    ],
  });
}

export function CustomersPage() {
  const { t } = useTranslation(['customers']);
  const queryClient = useQueryClient();

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
  };

  const removeCustomer = useCustomersRemove({ mutation: { onSuccess: invalidate } });
  const setStatus = useCustomersSetStatus({
    mutation: {
      onSuccess: invalidate,
      onError: (error) => {
        toast.add({
          type: 'error',
          title: t('status.changeFailed'),
          description: parseApiError(error).message,
        });
      },
    },
  });

  const filters: DataGridFilterDef<CustomersSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    statusFilter(t),
    kindFilter(t),
  ];

  const columns: DataGridColumn<Customer>[] = [
    {
      // Номер першим: у розмові й у документах клієнта називають саме ним.
      // Показуємо лейбл із конфігу тенанта, сортуємо по самому числу — рядкове
      // сортування зламалося б, щойно номер переріс би padding
      id: 'number',
      header: t('table.number'),
      sortable: true,
      cell: (c) => <span className="font-mono text-xs tabular-nums">{c.numberLabel}</span>,
    },
    {
      id: 'name',
      header: t('table.name'),
      isRowHeader: true,
      sortable: true,
      className: 'max-w-[22rem]',
      // Ідентичність — вхід у картку кастомера (та сама роль, що `UserIdentity`
      // на /users). Текстову позначку типу знято: її тепер несе форма медіа
      cell: (c) => (
        <Link
          to="/workspace/customers/$customerId"
          params={{ customerId: c.id }}
          className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CustomerIdentity
            kind={c.kind}
            name={c.name}
            email={c.email}
            phone={c.phone}
            numberLabel={c.numberLabel}
          />
        </Link>
      ),
    },
    {
      id: 'status',
      header: t('table.status'),
      sortable: true,
      cell: (c) => <StatusBadge status={c.status} label={t(`status.${c.status}`)} />,
    },
    {
      id: 'owner',
      header: t('table.owner'),
      cell: (c) =>
        c.owner ? (
          <span className="truncate">{c.owner.name ?? c.owner.email}</span>
        ) : (
          <span className="text-muted-foreground">{t('owner.none')}</span>
        ),
    },
    {
      id: 'tags',
      header: t('table.tags'),
      cell: (c) =>
        c.tags.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {c.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (c) => formatDate(c.createdAt),
    },
  ];

  const rowActions: DataGridRowAction<Customer>[] = [
    // Активний ↔ неактивний — робочий перемикач без підтвердження; архівація —
    // рішення, тому з діалогом (і саме вона потрапляє в журнал)
    {
      id: 'deactivate',
      label: t('status.deactivateAction'),
      isVisible: (c) => c.status === 'ACTIVE',
      onAction: (c) => {
        setStatus.mutate({ id: c.id, data: { status: 'INACTIVE' } });
      },
    },
    {
      id: 'activate',
      label: t('status.activateAction'),
      isVisible: (c) => c.status === 'INACTIVE',
      onAction: (c) => {
        setStatus.mutate({ id: c.id, data: { status: 'ACTIVE' } });
      },
    },
    {
      id: 'archive',
      label: t('status.archiveAction'),
      isVisible: (c) => c.status !== 'ARCHIVED',
      onAction: (c) => {
        setStatus.mutate({ id: c.id, data: { status: 'ARCHIVED' } });
      },
      confirm: {
        heading: t('status.archiveHeading'),
        body: (c) => (
          <Trans
            t={t}
            i18nKey="status.archiveBody"
            values={{ name: c.name }}
            components={{ strong: <strong /> }}
          />
        ),
        confirmLabel: t('status.archiveConfirm'),
        cancelLabel: t('status.archiveCancel'),
      },
    },
    {
      id: 'restore',
      label: t('status.restoreAction'),
      isVisible: (c) => c.status === 'ARCHIVED',
      onAction: (c) => {
        setStatus.mutate({ id: c.id, data: { status: 'ACTIVE' } });
      },
    },
    {
      id: 'delete',
      label: t('delete.button'),
      isDanger: true,
      onAction: (c) => {
        removeCustomer.mutate({ id: c.id });
      },
      confirm: {
        heading: t('delete.heading'),
        body: (c) => (
          <Trans
            t={t}
            i18nKey="delete.body"
            values={{ name: c.name }}
            components={{ strong: <strong /> }}
          />
        ),
        confirmLabel: t('delete.confirm'),
        cancelLabel: t('delete.cancel'),
      },
    },
  ];

  return (
    <Grid.Root
      useListQuery={(params, gridOptions) => useCustomersFindAll(params, { query: gridOptions })}
    >
      <PageBreadcrumbs items={[{ label: t('title') }]} />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <CreateCustomerModal />
      </div>

      <Grid.Toolbar
        filters={filters}
        totalLabel={t('toolbar.total')}
        selectedLabel={t('toolbar.selected')}
        size="sm"
        className="mb-3"
      />

      <Grid.Table
        ariaLabel={t('table.ariaLabel')}
        columns={columns}
        rowActions={rowActions}
        surface="card"
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />
    </Grid.Root>
  );
}
