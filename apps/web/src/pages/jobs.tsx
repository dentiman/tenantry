import { Card, Chip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JobState } from '@saas-skeleton/contracts';
import { useJobsFindAll, useJobsQueues } from '../api/generated/api';
import type { JobsFindAllParams } from '../api/generated/model';
import type { JobListResponseDtoOutputItemsItem } from '../api/generated/model/jobListResponseDtoOutputItemsItem';
import { formatDateTime } from '../lib/format';
import type { JobsSearch } from '../router';
import {
  DataGrid,
  DataGridFilters,
  defineFilters,
  gridQueryOptions,
  toGridQueryResult,
  useDataGridFilters,
} from '../components/data-grid';
import type { DataGridColumn, DataGridFilterDef } from '../components/data-grid';

const LIMIT = 20;
// Моніторинг: дані оновлюються самі, без ручного рефрешу
const REFETCH_INTERVAL_MS = 5000;

const JOB_STATES: JobState[] = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'];

const stateColor: Record<JobState, 'accent' | 'danger' | 'default' | 'success' | 'warning'> = {
  created: 'default',
  retry: 'warning',
  active: 'accent',
  completed: 'success',
  cancelled: 'default',
  failed: 'danger',
};

// Фабрики фільтрів, привʼязані до search-схеми роуту /jobs
const filter = defineFilters<JobsSearch>();

function jobStateLabel(t: TFunction<['jobs', 'common']>, state: JobState): string {
  return t(`states.${state}`);
}

export function JobsPage() {
  const { t } = useTranslation(['jobs', 'common']);
  // Фільтри живуть у search-параметрах роуту (?state=&queue=&page=&sortBy=…)
  const grid = useDataGridFilters<JobsSearch>();

  const params: JobsFindAllParams = { ...grid.filters, page: grid.page, limit: LIMIT };
  const list = toGridQueryResult(
    useJobsFindAll(params, {
      query: { ...gridQueryOptions, refetchInterval: REFETCH_INTERVAL_MS },
    }),
  );
  const { data: stats } = useJobsQueues({
    query: { refetchInterval: REFETCH_INTERVAL_MS },
  });
  const queues = stats?.queues ?? [];

  const filters: DataGridFilterDef<JobsSearch>[] = [
    filter.select({
      key: 'queue',
      ariaLabel: t('filters.queueLabel'),
      allLabel: t('filters.all', { label: t('filters.queueLabel') }),
      options: queues.map((q) => ({ id: q.name, label: q.name })),
    }),
    filter.select({
      key: 'state',
      ariaLabel: t('filters.stateLabel'),
      allLabel: t('filters.all', { label: t('filters.stateLabel') }),
      options: JOB_STATES.map((s) => ({ id: s, label: jobStateLabel(t, s) })),
    }),
  ];

  // sortable — тільки поля з whitelist JobQuerySchema.sortBy
  const columns: DataGridColumn<JobListResponseDtoOutputItemsItem>[] = [
    {
      id: 'name',
      header: t('table.queue'),
      isRowHeader: true,
      sortable: true,
      className: 'font-medium text-foreground',
      cell: (job) => job.name,
    },
    {
      id: 'state',
      header: t('table.state'),
      sortable: true,
      cell: (job) => (
        <Chip size="sm" color={stateColor[job.state]}>
          {jobStateLabel(t, job.state)}
        </Chip>
      ),
    },
    {
      id: 'attempts',
      header: t('table.attempts'),
      cell: (job) => `${String(job.retryCount)}/${String(job.retryLimit)}`,
    },
    {
      id: 'data',
      header: t('table.data'),
      cell: (job) =>
        job.data ? (
          <code className="block max-w-56 truncate text-xs" title={job.data}>
            {job.data}
          </code>
        ) : (
          '—'
        ),
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (job) => formatDateTime(job.createdAt),
    },
    {
      id: 'startedAt',
      header: t('table.started'),
      sortable: true,
      cell: (job) => formatDateTime(job.startedAt),
    },
    {
      id: 'completedAt',
      header: t('table.completed'),
      sortable: true,
      cell: (job) => formatDateTime(job.completedAt),
    },
    {
      id: 'output',
      header: t('table.output'),
      cell: (job) =>
        job.output ? (
          <span className="block max-w-56 truncate" title={job.output}>
            {job.output}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <DataGridFilters grid={grid} filters={filters} />
      </div>

      {queues.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {queues.map((q) => (
            <Card key={q.name} className="p-4">
              <p className="truncate text-sm font-medium text-foreground">{q.name}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>{t('queueCard.total', { count: q.total })}</span>
                <span>{t('queueCard.active', { count: q.active })}</span>
                <span>{t('queueCard.completed', { count: q.completed })}</span>
                {q.failed > 0 && (
                  <span className="text-danger">{t('queueCard.failed', { count: q.failed })}</span>
                )}
                {q.retry > 0 && (
                  <span className="text-warning">{t('queueCard.retry', { count: q.retry })}</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <DataGrid
        ariaLabel={t('table.ariaLabel')}
        columns={columns}
        grid={grid}
        list={list}
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />
    </div>
  );
}
