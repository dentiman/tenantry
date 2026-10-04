import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Coins, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { Alert, AlertDescription } from '@saas-skeleton/ui/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { useAiCostsBreakdown, useAiCostsSummary } from '../api/generated/api';
import type { PlatformAiCostsBreakdownResponseDtoOutputItemsItem } from '../api/generated/model/platformAiCostsBreakdownResponseDtoOutputItemsItem';
import { formatTokens, formatUsd } from '../lib/money';
import { AI_COST_DIMENSIONS, AI_COST_PERIODS, type AiCostsSearch } from '../router';

type Period = (typeof AI_COST_PERIODS)[number];
type Dimension = (typeof AI_COST_DIMENSIONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Межі періоду — UTC, напіввідкритий `[from, to)`, як рахує бекенд. Місяць — календарний:
 * так його виставляє провайдер у рахунку, і звірка «місяць проти рахунку» має сенс
 */
function periodRange(period: Period, now = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  switch (period) {
    case 'this-month':
      return {
        from: new Date(Date.UTC(year, month, 1)).toISOString(),
        to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
      };
    case 'last-month':
      return {
        from: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
        to: new Date(Date.UTC(year, month, 1)).toISOString(),
      };
    case 'last-30-days':
    case 'last-7-days': {
      // До кінця поточної хвилини: ключ запиту стабільний між рендерами
      const end = Math.ceil(now.getTime() / 60_000) * 60_000;
      const days = period === 'last-7-days' ? 7 : 30;
      return {
        from: new Date(end - days * DAY_MS).toISOString(),
        to: new Date(end).toISOString(),
      };
    }
  }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

/**
 * Витрати AI (AI-5b, docs/ai-platform-controls.md §3.5): журнал за період у розрізах.
 * Розріз — звичайна таблиця в картці, не DataGrid: рядків одиниці-десятки, без пагінації
 * й фільтрів (та сама композиція, що список tenant-ів, docs/frontend/ui-stack.md §DataGrid).
 */
export function AiCostsPage() {
  const { t } = useTranslation('ai');
  const search: AiCostsSearch = useSearch({ from: '/app/ai/costs' });
  const navigate = useNavigate();
  const period: Period = search.period ?? 'this-month';
  const by: Dimension = search.by ?? 'tenant';
  const range = periodRange(period);

  const summary = useAiCostsSummary(range);
  const breakdown = useAiCostsBreakdown({ ...range, by });

  const setSearch = (next: Partial<AiCostsSearch>): void => {
    void navigate({ to: '/ai/costs', search: (prev) => ({ ...prev, ...next }), replace: true });
  };

  const label = (item: PlatformAiCostsBreakdownResponseDtoOutputItemsItem): string =>
    by === 'kind' ? t(`costs.kinds.${item.key as 'generation'}`, item.label) : item.label;

  const data = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        label="AiCostsPage"
        breadcrumbs={[{ label: t('title') }, { label: t('costs.title') }]}
        subtitle={t('costs.subtitle')}
        actions={
          <Tabs
            value={period}
            onValueChange={(value: Period) => {
              setSearch({ period: value });
            }}
          >
            <TabsList aria-label={t('costs.periodLabel')}>
              {AI_COST_PERIODS.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`costs.periods.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      {summary.isError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{t('costs.loadFailed')}</AlertDescription>
        </Alert>
      )}

      {summary.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t('costs.loading')}
        </div>
      ) : data?.totals.calls === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Coins />
            </EmptyMedia>
            <EmptyTitle>{t('costs.empty')}</EmptyTitle>
            <EmptyDescription>{t('costs.emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label={t('costs.kpi.total')}
              value={formatUsd(data.totals.cost)}
              hint={t('costs.kpi.totalHint', {
                calls: formatTokens(data.totals.calls),
                tokens: formatTokens(data.totals.inputTokens + data.totals.outputTokens),
              })}
            />
            <Kpi
              label={t('costs.kpi.average')}
              value={
                data.replies.averageCompletedCost !== null
                  ? formatUsd(data.replies.averageCompletedCost)
                  : '—'
              }
              hint={t('costs.kpi.averageHint', {
                completed: formatTokens(data.replies.completed),
                count: formatTokens(data.replies.count),
              })}
            />
            <Kpi
              label={t('costs.kpi.failed')}
              value={formatUsd(data.replies.failedSpend)}
              hint={t('costs.kpi.failedHint', { retried: formatUsd(data.replies.retriedSpend) })}
            />
            <Kpi
              label={t('costs.kpi.cache')}
              value={formatUsd(data.cacheSavings)}
              hint={t('costs.kpi.cacheHint')}
            />
            <Kpi
              label={t('costs.kpi.reconciliation')}
              value={formatUsd(data.reconciliation.difference)}
              hint={t('costs.kpi.reconciliationHint', {
                rows: formatTokens(data.reconciliation.rows),
              })}
            />
            <Kpi
              label={t('costs.kpi.pending')}
              value={formatTokens(data.status.pending)}
              hint={t('costs.kpi.pendingHint', { unknown: formatTokens(data.status.unknown) })}
            />
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b py-3">
              <CardTitle>{t('costs.breakdown.title')}</CardTitle>
              <Tabs
                value={by}
                onValueChange={(value: Dimension) => {
                  setSearch({ by: value });
                }}
              >
                <TabsList variant="line">
                  {AI_COST_DIMENSIONS.map((value) => (
                    <TabsTrigger key={value} value={value}>
                      {t(`costs.breakdown.by.${value}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardHeader>
            <Table separator="inset" aria-label={t('costs.breakdown.ariaLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t('costs.breakdown.name')}</TableHead>
                  <TableHead className="text-right">{t('costs.breakdown.calls')}</TableHead>
                  <TableHead className="text-right">{t('costs.breakdown.inputTokens')}</TableHead>
                  <TableHead className="text-right">{t('costs.breakdown.outputTokens')}</TableHead>
                  <TableHead className="text-right">{t('costs.breakdown.reported')}</TableHead>
                  <TableHead className="text-right">{t('costs.breakdown.estimated')}</TableHead>
                  <TableHead className="pr-4 text-right">{t('costs.breakdown.cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.isPending ? (
                  <TableRow>
                    <TableCell colSpan={7} className="pl-4 text-muted-foreground">
                      {t('costs.loading')}
                    </TableCell>
                  </TableRow>
                ) : (
                  (breakdown.data?.items ?? []).map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="pl-4 font-medium text-foreground">
                        {label(item)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(item.calls)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(item.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(item.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(item.reportedCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(item.estimatedCost)}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-medium text-foreground tabular-nums">
                        {formatUsd(item.cost)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
