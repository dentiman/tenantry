import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import { ContextPanelPortal } from '@saas-skeleton/ui/components/context-panel-slot';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { createDataGrid, DEFAULT_PAGE_LIMIT } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridField,
  DataGridFieldSet,
  DataGridFilterDef,
  DataGridFiltersBase,
  DataGridListResponse,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';
import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  billedMonthsOf,
  generateMockInvoices,
  isOverdue,
  type InvoiceStatus,
  type MockInvoice,
  type PaymentMethod,
} from '../data/mock-invoices';
import { formatMonth, Money, Muted, notImplemented } from '../components/invoice-format';
import { CustomerIdentity } from '../../customers/components/customer-identity';
import { InvoicePanel } from '../components/invoice-panel';
import { InvoiceStatusBadge, XS_BADGE } from '../components/invoice-status-badge';
import { formatDate } from '@saas-skeleton/ui/lib/format';

type InvoicesSearch = DataGridFiltersBase & {
  status?: InvoiceStatus;
  billedMonth?: string;
  paymentMethod?: PaymentMethod;
};

const Grid = createDataGrid<InvoicesSearch, MockInvoice>();

/** Модульний рівень: дані не перегенеровуються на кожен рендер і однакові між візитами */
const INVOICES = generateMockInvoices(50);
const BILLED_MONTHS = billedMonthsOf(INVOICES);

/** Ключі сортування → значення, яке порівнюємо (клієнт — за іменем, не за об'єктом) */
const SORT_VALUE: Partial<Record<string, (invoice: MockInvoice) => string | number | null>> = {
  number: (i) => i.number,
  customer: (i) => i.customer.name,
  status: (i) => i.status,
  billedMonth: (i) => i.billedMonth,
  createdAt: (i) => i.createdAt,
  dueDate: (i) => i.dueDate,
  paidAt: (i) => i.paidAt,
  total: (i) => i.total,
  paymentAttempts: (i) => i.paymentAttempts,
};

/**
 * Замість orval-хука — чиста функція над масивом у памʼяті з тим самим контрактом
 * `DataGridUseListQuery`, тож грід не відрізняє демо від справжньої сторінки.
 */
function queryInvoices(
  params: InvoicesSearch & { page: number },
): DataGridListResponse<MockInvoice> {
  const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
  const search = params.search?.trim().toLowerCase() ?? '';
  let rows = INVOICES.filter(
    (invoice) =>
      (params.status === undefined || invoice.status === params.status) &&
      (params.billedMonth === undefined || invoice.billedMonth === params.billedMonth) &&
      (params.paymentMethod === undefined || invoice.paymentMethod === params.paymentMethod) &&
      (search === '' ||
        invoice.number.toLowerCase().includes(search) ||
        invoice.customer.name.toLowerCase().includes(search)),
  );
  const sortValue = params.sortBy ? SORT_VALUE[params.sortBy] : undefined;
  if (sortValue) {
    const sorted = [...rows].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      return String(left ?? '').localeCompare(String(right ?? ''));
    });
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

function buildFields(
  t: TFunction<'invoices-demo'>,
  onOpen: (invoice: MockInvoice) => void,
): DataGridField<MockInvoice>[] {
  const label = (id: string) => t(`fields.${id}`);
  const method = (value: PaymentMethod | null) =>
    value === null ? <Muted value={null} /> : t(`method.${value}`);
  // Номери документів і SAP — однакові приховані колонки «число або тире»
  const number = (
    id:
      | 'docNumber'
      | 'taxDocNumber'
      | 'sapDocEntry'
      | 'sapDocNum'
      | 'sapOrderDocEntry'
      | 'sapOrderDocNum'
      | 'sapIncomingPaymentDocEntry'
      | 'sapIncomingPaymentNumber',
  ) => ({
    id,
    header: label(id),
    defaultHidden: true,
    cell: (i: MockInvoice) => <Muted value={i[id]} />,
  });

  return [
    {
      // Номер — ідентичність рядка і вхід у деталі: клік відкриває context panel
      id: 'number',
      header: label('number'),
      isRowHeader: true,
      sortable: true,
      hideable: false,
      reorderable: false,
      // Композитна: номер (вхід у деталі), під ним статус і дата створення — головне про
      // інвойс читається з першої колонки, без окремих Status/Created
      cell: (i) => (
        <span className="flex flex-col items-start gap-1">
          <button
            type="button"
            className="rounded-sm font-mono text-xs font-medium tabular-nums text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onOpen(i);
            }}
          >
            {i.number}
          </button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <InvoiceStatusBadge status={i.status} size="xs" />
            {isOverdue(i) && (
              <Badge variant="warning" className={XS_BADGE}>
                {t('overdue')}
              </Badge>
            )}
            <span className="tabular-nums">{formatDate(i.createdAt)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'customer',
      header: label('customer'),
      sortable: true,
      className: 'max-w-[18rem]',
      // Той самий блок, що в списку клієнтів; без Link — клієнти фейкові, картки в них немає
      cell: (i) => (
        <CustomerIdentity
          id={i.customer.id}
          kind={i.customer.kind}
          name={i.customer.name}
          email={i.customer.email}
          phone={i.customer.phone}
          numberLabel={i.customer.numberLabel}
        />
      ),
    },
    {
      id: 'nationalId',
      header: label('nationalId'),
      defaultHidden: true,
      cell: (i) => <Muted value={i.customer.nationalId} />,
    },
    {
      id: 'status',
      header: label('status'),
      sortable: true,
      defaultHidden: true,
      cell: (i) => (
        <span className="flex items-center gap-1">
          <InvoiceStatusBadge status={i.status} />
          {isOverdue(i) && <Badge variant="warning">{t('overdue')}</Badge>}
        </span>
      ),
    },
    {
      id: 'billedMonth',
      header: label('billedMonth'),
      sortable: true,
      cell: (i) => formatMonth(i.billedMonth),
    },
    {
      id: 'createdAt',
      header: label('createdAt'),
      sortable: true,
      defaultHidden: true,
      cell: (i) => <DateTimeCell value={i.createdAt} />,
    },
    {
      id: 'dueDate',
      header: label('dueDate'),
      sortable: true,
      cell: (i) => (
        <span className={isOverdue(i) ? 'text-destructive tabular-nums' : 'tabular-nums'}>
          {i.dueDate}
        </span>
      ),
    },
    {
      id: 'subtotal',
      header: label('subtotal'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => <Money value={i.subtotal} />,
    },
    {
      id: 'taxPercent',
      header: label('taxPercent'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => `${String(i.taxPercent)}%`,
    },
    {
      id: 'taxAmount',
      header: label('taxAmount'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => <Money value={i.taxAmount} />,
    },
    {
      id: 'total',
      header: label('total'),
      align: 'end',
      sortable: true,
      cell: (i) => <Money value={i.total} />,
    },
    {
      id: 'paidAt',
      header: label('paidAt'),
      sortable: true,
      cell: (i) => <DateTimeCell value={i.paidAt} />,
    },
    {
      id: 'paymentMethod',
      header: label('paymentMethod'),
      defaultHidden: true,
      cell: (i) => method(i.paymentMethod),
    },
    {
      id: 'paidMethod',
      header: label('paidMethod'),
      defaultHidden: true,
      cell: (i) => method(i.paidMethod),
    },
    {
      id: 'paymentAttempts',
      header: label('paymentAttempts'),
      align: 'end',
      sortable: true,
      defaultHidden: true,
      cell: (i) => i.paymentAttempts,
    },
    {
      id: 'emailedAt',
      header: label('emailedAt'),
      defaultHidden: true,
      cell: (i) => <DateTimeCell value={i.emailedAt} />,
    },
    {
      id: 'items',
      header: label('items'),
      align: 'end',
      defaultHidden: true,
      cell: (i) => i.items.length,
    },
    number('docNumber'),
    number('taxDocNumber'),
    {
      id: 'taxDate',
      header: label('taxDate'),
      defaultHidden: true,
      cell: (i) => <Muted value={i.taxDate} />,
    },
    {
      id: 'taxConfirmationNumber',
      header: label('taxConfirmationNumber'),
      defaultHidden: true,
      cell: (i) => <Muted value={i.taxConfirmationNumber} />,
    },
    {
      id: 'taxConfirmedAt',
      header: label('taxConfirmedAt'),
      defaultHidden: true,
      cell: (i) => <DateTimeCell value={i.taxConfirmedAt} />,
    },
    number('sapDocEntry'),
    number('sapDocNum'),
    number('sapOrderDocEntry'),
    number('sapOrderDocNum'),
    number('sapIncomingPaymentDocEntry'),
    number('sapIncomingPaymentNumber'),
  ];
}

function selectFilters(t: TFunction<'invoices-demo'>): DataGridFilterDef<InvoicesSearch>[] {
  return [
    Grid.filter.select({
      key: 'status',
      ariaLabel: t('filters.statusLabel'),
      allLabel: t('filters.statusAll'),
      options: INVOICE_STATUSES.map((status) => ({ id: status, label: t(`status.${status}`) })),
    }),
    Grid.filter.select({
      key: 'billedMonth',
      ariaLabel: t('filters.monthLabel'),
      allLabel: t('filters.monthAll'),
      options: BILLED_MONTHS.map((month) => ({ id: month, label: formatMonth(month) })),
    }),
    Grid.filter.select({
      key: 'paymentMethod',
      ariaLabel: t('filters.methodLabel'),
      allLabel: t('filters.methodAll'),
      options: PAYMENT_METHODS.map((value) => ({ id: value, label: t(`method.${value}`) })),
    }),
  ];
}

/**
 * Демо-сторінка інвойсів (фейкові дані, без бекенду): грід з наборами колонок, фільтрами,
 * деталями в context panel, меню дій рядка і смугою масових дій — усе дії заглушки.
 * Структура й операції повторюють FMS (`fms-admin` InvoicesTable, `fms-api` Invoice).
 */
export function InvoicesDemoPage() {
  const { t } = useTranslation('invoices-demo');
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = useMemo(
    () =>
      buildFields(t, (invoice) => {
        setOpenId(invoice.id);
      }),
    [t],
  );
  const openInvoice = INVOICES.find((invoice) => invoice.id === openId) ?? null;

  const single = (action: string) => (invoice: MockInvoice) => {
    notImplemented(t('demoToast.single', { action, number: invoice.number }), t);
  };
  const isOpen = (i: MockInvoice) => i.status === 'NEW' || i.status === 'IN_COLLECTION';

  // Пункти й умови видимості — як у FMS: що можна зробити з інвойсом у його статусі
  const rowActions: DataGridRowAction<MockInvoice>[] = [
    { id: 'pdf', label: t('actions.downloadPdf'), onAction: single(t('actions.downloadPdf')) },
    {
      id: 'email',
      label: t('actions.sendEmail'),
      isVisible: (i) => i.status !== 'CANCELED',
      onAction: single(t('actions.sendEmail')),
    },
    {
      id: 'charge',
      label: t('actions.chargeCard'),
      isVisible: isOpen,
      onAction: single(t('actions.chargeCard')),
    },
    {
      id: 'collection',
      label: t('actions.collectionTransactions'),
      isVisible: (i) => i.paymentMethod === 'DIRECT_DEBIT',
      onAction: single(t('actions.collectionTransactions')),
    },
    {
      id: 'taxDate',
      label: t('actions.changeTaxDate'),
      isVisible: (i) => i.status === 'PAID',
      onAction: single(t('actions.changeTaxDate')),
    },
    {
      id: 'taxConfirmation',
      label: t('actions.registerTaxConfirmation'),
      isVisible: (i) => i.status === 'PAID' && i.taxConfirmationNumber === null,
      onAction: single(t('actions.registerTaxConfirmation')),
    },
    {
      id: 'cancel',
      label: t('actions.cancel'),
      isDanger: true,
      isVisible: isOpen,
      onAction: single(t('actions.cancel')),
    },
  ];

  // Масові дії FMS (`InvoiceCollectionInput`, INVOICE_DEFAULT_ALLOWED_ACTIONS): часті —
  // кнопками, решта — у «More», щоб смуга вибору не розросталась на кілька рядків
  const bulkPrimary = ['sendEmail', 'charge', 'directDebitFile'] as const;
  const bulkMore = ['registerTaxConfirmations', 'createInSap', 'suspendServices'] as const;
  const runBulk = (id: string, count: number) => {
    notImplemented(t('demoToast.bulk', { action: t(`bulk.${id}`), count }), t);
  };

  const fieldSets: DataGridFieldSet[] = [
    {
      id: 'main',
      label: t('fieldSets.main'),
      fields: ['number', 'customer', 'billedMonth', 'dueDate', 'total', 'paidAt'],
    },
    {
      id: 'payment',
      label: t('fieldSets.payment'),
      fields: [
        'number',
        'customer',
        'total',
        'paymentMethod',
        'paidMethod',
        'paidAt',
        'paymentAttempts',
        'emailedAt',
      ],
    },
    {
      id: 'tax',
      label: t('fieldSets.tax'),
      fields: [
        'number',
        'customer',
        'nationalId',
        'subtotal',
        'taxPercent',
        'taxAmount',
        'total',
        'docNumber',
        'taxDocNumber',
        'taxDate',
        'taxConfirmationNumber',
        'taxConfirmedAt',
      ],
    },
    {
      id: 'sap',
      label: t('fieldSets.sap'),
      fields: [
        'number',
        'customer',
        'total',
        'sapDocEntry',
        'sapDocNum',
        'sapOrderDocEntry',
        'sapOrderDocNum',
        'sapIncomingPaymentDocEntry',
        'sapIncomingPaymentNumber',
      ],
    },
  ];

  const filters: DataGridFilterDef<InvoicesSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    ...selectFilters(t),
  ];

  return (
    <Grid.Root
      useListQuery={(params) => ({
        data: queryInvoices(params),
        isLoading: false,
        isPlaceholderData: false,
      })}
      // Роут без validateSearch-схеми — фільтри живуть локально, не в URL
      syncToUrl={false}
      selection
      gridId="demo.invoices"
      fields={fields}
    >
      <PageHeader
        label="InvoicesDemoPage"
        breadcrumbs={[{ label: t('title') }]}
        subtitle={t('subtitle')}
        actions={
          <Button
            size="sm"
            onClick={() => {
              notImplemented(t('demoToast.page', { action: t('newInvoice') }), t);
            }}
          >
            <Plus />
            {t('newInvoice')}
          </Button>
        }
      />

      <div className="border-b border-border">
        <Grid.Toolbar
          surface="band"
          filters={filters}
          totalLabel={t('toolbar.total')}
          selectedLabel={t('toolbar.selected')}
          size="sm"
          selectionActions={(selection) => (
            <>
              {bulkPrimary.map((id) => (
                <Button
                  key={id}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    runBulk(id, selection.selectedItems.length);
                  }}
                >
                  {t(`bulk.${id}`)}
                </Button>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                  {t('bulk.more')}
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {bulkMore.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      variant={id === 'suspendServices' ? 'destructive' : 'default'}
                      onClick={() => {
                        runBulk(id, selection.selectedItems.length);
                      }}
                    >
                      {t(`bulk.${id}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        />
      </div>

      <Grid.FieldSets sets={fieldSets} className="border-b border-border px-6" />

      <Grid.Table
        ariaLabel={t('ariaLabel')}
        rowActions={rowActions}
        actionsHeader={<Grid.FieldSettings />}
        isRowMuted={(i) => i.status === 'CANCELED'}
        surface="flush"
        messages={{ empty: t('empty') }}
      />

      {/* Деталі — у третій колонці шела, а не в Sheet: список лишається видимим поруч.
          `contentKey` знову розкриває згорнуту панель при кліку на інший інвойс */}
      {openInvoice !== null && (
        <ContextPanelPortal contentKey={openInvoice.id} label="InvoicesDemoPage">
          <InvoicePanel
            invoice={openInvoice}
            onClose={() => {
              setOpenId(null);
            }}
          />
        </ContextPanelPortal>
      )}
    </Grid.Root>
  );
}
