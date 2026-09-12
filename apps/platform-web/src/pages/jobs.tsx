import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JobState } from '@saas-skeleton/contracts';
import { useJobsFindAll, useJobsQueues } from '../api/generated/api';
import type { JobListResponseDtoOutputItemsItem } from '../api/generated/model/jobListResponseDtoOutputItemsItem';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import type { JobsSearch } from '../router';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { JobDetailsPanel } from '../components/job-details-panel';
import { useState } from 'react';

// Моніторинг: дані оновлюються самі, без ручного рефрешу
const REFETCH_INTERVAL_MS = 5000;

const JOB_STATES: JobState[] = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'];

// `default` badge — суцільна заливка primary; для нейтральних станів беремо `secondary`
const stateVariant: Record<
  JobState,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning'
> = {
  created: 'secondary',
  retry: 'warning',
  active: 'default',
  completed: 'success',
  cancelled: 'secondary',
  failed: 'destructive',
};

// Типізований компаунд-набір гріда цієї сторінки; Grid.filter — фабрики фільтрів,
// привʼязані до search-схеми роуту /operations/jobs
const Grid = createDataGrid<JobsSearch, JobListResponseDtoOutputItemsItem>();

function jobStateLabel(t: TFunction<['jobs', 'common']>, state: JobState): string {
  return t(`states.${state}`);
}

/**
 * MT-3: переїхало сюди з tenant-web разом із самим модулем моніторингу —
 * pgboss.job поза RLS, тож повний (крос-tenant) список легальний тільки
 * в control plane. Сітка карток черг переїхала на окрему `/operations/queues`
 * (крок 6 плану шела) — тепер таблиця сама впирається в краї, як `/users`.
 */
export function JobsPage() {
  const { t } = useTranslation(['jobs', 'common']);
  const [selectedJob, setSelectedJob] = useState<JobListResponseDtoOutputItemsItem | null>(null);

  // Лише список назв черг для фільтра — картки статистики переїхали на /operations/queues
  const { data: stats } = useJobsQueues();
  const queues = stats?.queues ?? [];

  const filters: DataGridFilterDef<JobsSearch>[] = [
    Grid.filter.select({
      key: 'queue',
      ariaLabel: t('filters.queueLabel'),
      allLabel: t('filters.all', { label: t('filters.queueLabel') }),
      options: queues.map((q) => ({ id: q.name, label: q.name })),
    }),
    Grid.filter.select({
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
      cell: (job) => <Badge variant={stateVariant[job.state]}>{jobStateLabel(t, job.state)}</Badge>,
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
      cell: (job) => <DateTimeCell value={job.createdAt} />,
    },
    {
      id: 'startedAt',
      header: t('table.started'),
      sortable: true,
      cell: (job) => <DateTimeCell value={job.startedAt} />,
    },
    {
      id: 'completedAt',
      header: t('table.completed'),
      sortable: true,
      cell: (job) => <DateTimeCell value={job.completedAt} />,
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

  const rowActions: DataGridRowAction<JobListResponseDtoOutputItemsItem>[] = [
    {
      id: 'details',
      label: t('table.viewDetails'),
      onAction: (job) => {
        setSelectedJob(job);
      },
    },
  ];

  return (
    // limit не шлемо — дефолт задає бекенд (PaginationQuerySchema, 20)
    <Grid.Root
      useListQuery={(params, gridOptions) =>
        useJobsFindAll(params, {
          query: { ...gridOptions, refetchInterval: REFETCH_INTERVAL_MS },
        })
      }
    >
      <PageHeader
        label="JobsPage"
        breadcrumbs={[{ label: t('title') }]}
        subtitle={t('subtitle')}
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
        surface="flush"
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />

      <JobDetailsPanel
        job={selectedJob}
        onClose={() => {
          setSelectedJob(null);
        }}
      />
    </Grid.Root>
  );
}
