import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { useJobsQueues } from '../../../api/generated/api';

// Той самий інтервал, що на /operations/jobs — сторінки моніторингу оновлюються самі
const REFETCH_INTERVAL_MS = 5000;

/**
 * Черги — сітка карток статистики, перенесена СЮДИ з `/operations/jobs`
 * (крок 6 плану шела): картки над таблицею не давали їй стати `bleed`-полотном,
 * а розділення дає Operations другий реальний пункт меню.
 */
export function QueuesPage() {
  const { t } = useTranslation(['jobs', 'common']);
  const { data: stats } = useJobsQueues({ query: { refetchInterval: REFETCH_INTERVAL_MS } });
  const queues = stats?.queues ?? [];

  return (
    <div>
      <PageHeader
        label="QueuesPage"
        breadcrumbs={[{ label: t('queuesTitle') }]}
        subtitle={t('queuesSubtitle')}
      />

      {queues.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGrid />
            </EmptyMedia>
            <EmptyTitle>{t('queueCard.empty')}</EmptyTitle>
            <EmptyDescription>{t('queueCard.emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {queues.map((q) => (
            <Card key={q.name} size="sm">
              <CardContent className="flex flex-col gap-2">
                <p className="truncate text-sm font-medium text-foreground">{q.name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t('queueCard.total', { count: q.total })}</span>
                  <span>{t('queueCard.active', { count: q.active })}</span>
                  <span>{t('queueCard.completed', { count: q.completed })}</span>
                  {q.failed > 0 && (
                    <span className="text-destructive">
                      {t('queueCard.failed', { count: q.failed })}
                    </span>
                  )}
                  {q.retry > 0 && (
                    <span className="text-warning">{t('queueCard.retry', { count: q.retry })}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
