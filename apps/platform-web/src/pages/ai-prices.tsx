import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';
import {
  getAiCostsListPricesQueryKey,
  useAiCostsListPrices,
  useAiCostsSyncPrices,
} from '../api/generated/api';
import type { AiModelPriceListResponseDtoOutputItemsItem } from '../api/generated/model/aiModelPriceListResponseDtoOutputItemsItem';
import { AiPriceCreateModal } from '../components/ai-price-create-modal';
import { AiPriceHistoryPanel } from '../components/ai-price-history-panel';
import { formatPrice } from '../lib/money';
import type { AiPricesSearch } from '../router';

type Price = AiModelPriceListResponseDtoOutputItemsItem;

const Grid = createDataGrid<AiPricesSearch, Price>();

/** Ручний тариф на модель OpenRouter живе до наступної синхронізації (design.md R7) */
function SourceBadge({ price }: { price: Price }) {
  const { t } = useTranslation('ai');
  const badge = (
    <Badge variant={price.source === 'manual' ? 'warning' : 'secondary'}>
      {t(`prices.sources.${price.source}`)}
    </Badge>
  );
  if (price.source !== 'manual' || price.provider !== 'openrouter') {
    return badge;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{badge}</TooltipTrigger>
      <TooltipContent>{t('prices.manualOnOpenRouter')}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Тарифи моделей (AI-5b, docs/ai-platform-controls.md §3.3): чинна ціна кожної пари
 * провайдер + модель, історія — у контекстній панелі, ручний ввід і синхронізація з
 * OpenRouter — у хедері сторінки. Ціни — USD за 1M токенів, рядками без округлення.
 */
export function AiPricesPage() {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const sync = useAiCostsSyncPrices();
  const [selected, setSelected] = useState<Price | null>(null);

  const runSync = async (): Promise<void> => {
    try {
      const result = await sync.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getAiCostsListPricesQueryKey() });
      toast.add({
        type: result.errors.length > 0 ? 'warning' : 'success',
        title:
          result.errors.length > 0
            ? t('prices.sync.partial')
            : t('prices.sync.done', { created: result.created, unchanged: result.unchanged }),
        ...(result.errors.length > 0
          ? {
              description: [
                t('prices.sync.done', { created: result.created, unchanged: result.unchanged }),
                ...result.errors.map((error) => error.message),
              ].join('. '),
            }
          : {}),
      });
    } catch {
      // Мережа/5xx уже показав глобальний toast; тут — лише що саме не вдалося
      toast.add({ type: 'error', title: t('prices.sync.failed') });
    }
  };

  const filters: DataGridFilterDef<AiPricesSearch>[] = [
    Grid.filter.search({
      ariaLabel: t('prices.searchPlaceholder'),
      placeholder: t('prices.searchPlaceholder'),
    }),
  ];

  const price = (value: string | null): string => (value !== null ? formatPrice(value) : '—');
  const columns: DataGridColumn<Price>[] = [
    {
      id: 'model',
      header: t('prices.model'),
      isRowHeader: true,
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-foreground">{row.model}</span>
          <span className="truncate text-xs text-muted-foreground">{row.provider}</span>
        </div>
      ),
    },
    {
      id: 'input',
      header: t('prices.input'),
      className: 'tabular-nums',
      cell: (row) => price(row.inputPerMillion),
    },
    {
      id: 'cacheRead',
      header: t('prices.cacheRead'),
      className: 'tabular-nums',
      cell: (row) => price(row.cacheReadPerMillion),
    },
    {
      id: 'cacheWrite',
      header: t('prices.cacheWrite'),
      className: 'tabular-nums',
      cell: (row) => price(row.cacheWritePerMillion),
    },
    {
      id: 'output',
      header: t('prices.output'),
      className: 'tabular-nums',
      cell: (row) => price(row.outputPerMillion),
    },
    {
      id: 'tiers',
      header: t('prices.tiers'),
      cell: (row) =>
        row.tiers && row.tiers.length > 0 ? (
          <Badge variant="secondary">{t('prices.tiersCount', { count: row.tiers.length })}</Badge>
        ) : (
          '—'
        ),
    },
    {
      id: 'source',
      header: t('prices.source'),
      cell: (row) => <SourceBadge price={row} />,
    },
    {
      id: 'validFrom',
      header: t('prices.validFrom'),
      cell: (row) => <DateTimeCell value={row.validFrom} />,
    },
  ];

  const rowActions: DataGridRowAction<Price>[] = [
    {
      id: 'history',
      label: t('prices.historyAction'),
      onAction: (row) => {
        setSelected(row);
      },
    },
  ];

  return (
    <Grid.Root
      useListQuery={(params, gridOptions) => useAiCostsListPrices(params, { query: gridOptions })}
    >
      <PageHeader
        label="AiPricesPage"
        breadcrumbs={[{ label: t('title') }, { label: t('prices.title') }]}
        subtitle={t('prices.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={sync.isPending}
              onClick={() => void runSync()}
            >
              <RefreshCw data-icon="inline-start" />
              {sync.isPending ? t('prices.sync.running') : t('prices.sync.action')}
            </Button>
            <AiPriceCreateModal />
          </div>
        }
      />

      <div className="border-b border-border">
        <Grid.Toolbar
          surface="band"
          filters={filters}
          totalLabel={t('prices.total')}
          selectedLabel={t('prices.selected')}
          size="sm"
        />
      </div>

      <Grid.Table
        ariaLabel={t('prices.ariaLabel')}
        columns={columns}
        rowActions={rowActions}
        surface="flush"
        messages={{ loading: t('prices.loading'), empty: t('prices.empty') }}
      />

      <AiPriceHistoryPanel
        price={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </Grid.Root>
  );
}
