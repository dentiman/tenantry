import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { createDataGrid, DEFAULT_PAGE_LIMIT } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridField,
  DataGridFieldSet,
  DataGridFieldSettingsLayout,
  DataGridFilterDef,
  DataGridFiltersBase,
  DataGridListResponse,
} from '@saas-skeleton/ui/components/data-grid';
import {
  INVOICE_STATUSES,
  generateMockInvoices,
  type InvoiceStatus,
  type MockInvoice,
} from '../components/mock-invoices';

type InvoicesSearch = DataGridFiltersBase & { status?: InvoiceStatus };

const Grid = createDataGrid<InvoicesSearch, MockInvoice>();

/** Модульний рівень: дані не перегенеровуються на кожен рендер і однакові між візитами */
const INVOICES = generateMockInvoices(50);

const STATUS_VARIANT: Record<InvoiceStatus, 'success' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline',
  SENT: 'secondary',
  PAID: 'success',
  OVERDUE: 'destructive',
  VOID: 'outline',
};

/**
 * Сортування на клієнті — лише для стенду. Порівнюється те, що лежить у полі:
 * числа як числа, ISO-дати і рядки — лексикографічно (для ISO це і є хронологія).
 */
function compareBy(field: keyof MockInvoice) {
  return (a: MockInvoice, b: MockInvoice): number => {
    const left = a[field];
    const right = b[field];
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }
    return String(left ?? '').localeCompare(String(right ?? ''));
  };
}

/**
 * Замість orval-хука — чиста функція над масивом у памʼяті: той самий контракт
 * `DataGridUseListQuery` (params → { data, isLoading, isPlaceholderData }), тож
 * грід не відрізняє стенд від справжньої сторінки.
 */
function queryInvoices(
  params: InvoicesSearch & { page: number },
): DataGridListResponse<MockInvoice> {
  const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
  const search = params.search?.trim().toLowerCase() ?? '';
  let rows = INVOICES.filter(
    (invoice) =>
      (params.status === undefined || invoice.status === params.status) &&
      (search === '' ||
        invoice.number.toLowerCase().includes(search) ||
        invoice.customer.toLowerCase().includes(search)),
  );
  if (params.sortBy && params.sortBy in (INVOICES[0] ?? {})) {
    const sorted = [...rows].sort(compareBy(params.sortBy as keyof MockInvoice));
    rows = params.sortOrder === 'desc' ? sorted.reverse() : sorted;
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(params.page, totalPages);
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    totalPages,
  };
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value);
}

function Money({ value, currency }: { value: number; currency: string }) {
  return <span className="tabular-nums">{money(value, currency)}</span>;
}

function PlainDate({ value }: { value: string | null }) {
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{value}</span>
  );
}

function Text({ value }: { value: string | null }) {
  return value ? (
    <span className="block max-w-[16rem] truncate">{value}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function buildFields(t: TFunction<'playground'>): DataGridField<MockInvoice>[] {
  const label = (id: string) => t(`dataGrid.fields.${id}`);
  const money = (id: 'subtotal' | 'discount' | 'tax' | 'total' | 'amountPaid' | 'balanceDue') => ({
    id,
    header: label(id),
    align: 'end' as const,
    sortable: id === 'total' || id === 'balanceDue',
    cell: (invoice: MockInvoice) => <Money value={invoice[id]} currency={invoice.currency} />,
  });
  return [
    {
      // Номер — ідентичність рядка: не ховається і закріплений першим (primary field)
      id: 'number',
      header: label('number'),
      isRowHeader: true,
      sortable: true,
      hideable: false,
      reorderable: false,
      cell: (invoice) => <span className="font-mono text-xs tabular-nums">{invoice.number}</span>,
    },
    {
      id: 'customer',
      header: label('customer'),
      sortable: true,
      cell: (i) => <Text value={i.customer} />,
    },
    {
      id: 'status',
      header: label('status'),
      sortable: true,
      cell: (i) => (
        <Badge variant={STATUS_VARIANT[i.status]}>{t(`dataGrid.status.${i.status}`)}</Badge>
      ),
    },
    {
      id: 'issueDate',
      header: label('issueDate'),
      sortable: true,
      cell: (i) => <PlainDate value={i.issueDate} />,
    },
    {
      id: 'dueDate',
      header: label('dueDate'),
      sortable: true,
      cell: (i) => <PlainDate value={i.dueDate} />,
    },
    {
      id: 'paidDate',
      header: label('paidDate'),
      defaultHidden: true,
      cell: (i) => <PlainDate value={i.paidDate} />,
    },
    { id: 'currency', header: label('currency'), defaultHidden: true, cell: (i) => i.currency },
    { ...money('subtotal'), defaultHidden: true },
    { ...money('discount'), defaultHidden: true },
    { ...money('tax'), defaultHidden: true },
    money('total'),
    { ...money('amountPaid'), defaultHidden: true },
    money('balanceDue'),
    {
      id: 'paymentTerms',
      header: label('paymentTerms'),
      defaultHidden: true,
      cell: (i) => i.paymentTerms,
    },
    {
      id: 'paymentMethod',
      header: label('paymentMethod'),
      defaultHidden: true,
      cell: (i) => <Text value={i.paymentMethod} />,
    },
    {
      id: 'owner',
      header: label('owner'),
      defaultHidden: true,
      cell: (i) => <Text value={i.owner} />,
    },
    {
      id: 'billingEmail',
      header: label('billingEmail'),
      defaultHidden: true,
      cell: (i) => <Text value={i.billingEmail} />,
    },
    {
      id: 'billingCountry',
      header: label('billingCountry'),
      defaultHidden: true,
      cell: (i) => i.billingCountry,
    },
    {
      id: 'billingCity',
      header: label('billingCity'),
      defaultHidden: true,
      cell: (i) => i.billingCity,
    },
    {
      id: 'poNumber',
      header: label('poNumber'),
      defaultHidden: true,
      cell: (i) => <Text value={i.poNumber} />,
    },
    {
      id: 'project',
      header: label('project'),
      defaultHidden: true,
      cell: (i) => <Text value={i.project} />,
    },
    {
      id: 'department',
      header: label('department'),
      defaultHidden: true,
      cell: (i) => i.department,
    },
    {
      id: 'lineItems',
      header: label('lineItems'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => i.lineItems,
    },
    {
      id: 'remindersSent',
      header: label('remindersSent'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => i.remindersSent,
    },
    {
      id: 'lastReminder',
      header: label('lastReminder'),
      defaultHidden: true,
      cell: (i) => <PlainDate value={i.lastReminder} />,
    },
    {
      id: 'daysOverdue',
      header: label('daysOverdue'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => (i.daysOverdue > 0 ? i.daysOverdue : '—'),
    },
    {
      id: 'notes',
      header: label('notes'),
      defaultHidden: true,
      cell: (i) => <Text value={i.notes} />,
    },
    {
      id: 'tags',
      header: label('tags'),
      defaultHidden: true,
      cell: (i) =>
        i.tags.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {i.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </span>
        ),
    },
    { id: 'source', header: label('source'), defaultHidden: true, cell: (i) => i.source },
    {
      id: 'exported',
      header: label('exported'),
      defaultHidden: true,
      cell: (i) => (i.exported ? t('dataGrid.yes') : t('dataGrid.no')),
    },
    {
      id: 'createdAt',
      header: label('createdAt'),
      sortable: true,
      defaultHidden: true,
      cell: (i) => <DateTimeCell value={i.createdAt} />,
    },
    {
      id: 'updatedAt',
      header: label('updatedAt'),
      defaultHidden: true,
      cell: (i) => <DateTimeCell value={i.updatedAt} />,
    },
  ];
}

function statusFilter(t: TFunction<'playground'>): DataGridFilterDef<InvoicesSearch> {
  return Grid.filter.select({
    key: 'status',
    ariaLabel: t('dataGrid.statusLabel'),
    allLabel: t('dataGrid.statusAll'),
    options: INVOICE_STATUSES.map((status) => ({
      id: status,
      label: t(`dataGrid.status.${status}`),
    })),
  });
}

/**
 * Стенд DataGrid на фейкових інвойсах: 50 рядків × 32 поля — щоб побачити панель
 * полів, коли полів багато, набори полів, порядок і перетягування заголовків у
 * широкій таблиці, яка прокручується. Розкладка — та сама, що в Customers/Users
 * (`bleed`, смуга фільтрів, таби наборів впритул до таблиці, шестерня в хедері дій).
 */
export function PlaygroundDataGridPage() {
  const { t } = useTranslation('playground');
  const fields = useMemo(() => buildFields(t), [t]);
  // Лише для стенду: порівняти розкладки панелі полів на тих самих 32 полях. Дефолт —
  // `auto`, як у продукті (тут, із 32 полями, він дає дві колонки)
  const [panelLayout, setPanelLayout] = useState<DataGridFieldSettingsLayout>('auto');

  const fieldSets: DataGridFieldSet[] = [
    {
      id: 'main',
      label: t('dataGrid.fieldSets.main'),
      fields: ['number', 'customer', 'status', 'issueDate', 'dueDate', 'total', 'balanceDue'],
    },
    {
      id: 'finance',
      label: t('dataGrid.fieldSets.finance'),
      fields: [
        'number',
        'customer',
        'currency',
        'subtotal',
        'discount',
        'tax',
        'total',
        'amountPaid',
        'balanceDue',
        'paymentMethod',
      ],
    },
    {
      id: 'collections',
      label: t('dataGrid.fieldSets.collections'),
      fields: [
        'number',
        'customer',
        'status',
        'dueDate',
        'daysOverdue',
        'balanceDue',
        'remindersSent',
        'lastReminder',
        'owner',
        'billingEmail',
      ],
    },
    {
      id: 'audit',
      label: t('dataGrid.fieldSets.audit'),
      fields: ['number', 'source', 'exported', 'owner', 'createdAt', 'updatedAt'],
    },
  ];

  const filters: DataGridFilterDef<InvoicesSearch>[] = [
    Grid.filter.search({
      ariaLabel: t('dataGrid.searchLabel'),
      placeholder: t('dataGrid.searchPlaceholder'),
    }),
    statusFilter(t),
  ];

  return (
    <Grid.Root
      useListQuery={(params) => ({
        data: queryInvoices(params),
        isLoading: false,
        isPlaceholderData: false,
      })}
      // Стенд не має validateSearch-схеми в роуті — фільтри живуть локально
      syncToUrl={false}
      selection
      gridId="playground.invoices"
      fields={fields}
    >
      <PageHeader
        label="PlaygroundDataGridPage"
        breadcrumbs={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.dataGrid') },
        ]}
        subtitle={t('dataGrid.subtitle')}
        actions={
          <Tabs
            value={panelLayout}
            onValueChange={(next: DataGridFieldSettingsLayout) => {
              setPanelLayout(next);
            }}
          >
            <TabsList size="sm" aria-label={t('dataGrid.panelLayout.label')}>
              <TabsTrigger value="auto">{t('dataGrid.panelLayout.auto')}</TabsTrigger>
              <TabsTrigger value="list">{t('dataGrid.panelLayout.list')}</TabsTrigger>
              <TabsTrigger value="split">{t('dataGrid.panelLayout.split')}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="border-b border-border">
        <Grid.Toolbar
          surface="band"
          filters={filters}
          totalLabel={t('dataGrid.toolbar.total')}
          selectedLabel={t('dataGrid.toolbar.selected')}
          size="sm"
        />
      </div>

      <Grid.FieldSets sets={fieldSets} className="border-b border-border px-6" />

      <Grid.Table
        ariaLabel={t('dataGrid.ariaLabel')}
        actionsHeader={<Grid.FieldSettings layout={panelLayout} />}
        isRowMuted={(invoice) => invoice.status === 'VOID'}
        surface="flush"
        messages={{ empty: t('dataGrid.empty') }}
      />
    </Grid.Root>
  );
}
