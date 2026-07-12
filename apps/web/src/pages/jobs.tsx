import { Card, Chip, ListBox, Pagination, Select, Spinner, Table } from '@heroui/react';
import { getRouteApi } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JobState } from '@saas-skeleton/contracts';
import { useJobsFindAll, useJobsQueues } from '../api/generated/api';
import type { JobsFindAllParams } from '../api/generated/model';
import { pageItems } from '../lib/page-items';
import { formatDateTime } from '../lib/format';

const LIMIT = 20;
// Моніторинг: дані оновлюються самі, без ручного рефрешу
const REFETCH_INTERVAL_MS = 5000;

const routeApi = getRouteApi('/app/jobs');

const JOB_STATES: JobState[] = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'];

const stateColor: Record<JobState, 'accent' | 'danger' | 'default' | 'success' | 'warning'> = {
  created: 'default',
  retry: 'warning',
  active: 'accent',
  completed: 'success',
  cancelled: 'default',
  failed: 'danger',
};

interface FilterSelectProps {
  ariaLabel: string;
  allLabel: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (value: string | undefined) => void;
}

function FilterSelect({ ariaLabel, allLabel, value, options, onChange }: FilterSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      className="w-48"
      value={value ?? 'all'}
      onChange={(key) => {
        onChange(key === 'all' ? undefined : String(key));
      }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="all" textValue={allLabel}>
            {allLabel}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function jobStateLabel(t: TFunction<['jobs', 'common']>, state: JobState): string {
  return t(`states.${state}`);
}

export function JobsPage() {
  const { t } = useTranslation(['jobs', 'common']);
  // Джерело правди для фільтрів/сторінки — URL (?state=&queue=&page=)
  const { page = 1, state, queue } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  const params: JobsFindAllParams = {
    page,
    limit: LIMIT,
    ...(state ? { state } : {}),
    ...(queue ? { queue } : {}),
  };

  const { data, isLoading } = useJobsFindAll(params, {
    query: { refetchInterval: REFETCH_INTERVAL_MS },
  });
  const { data: stats } = useJobsQueues({
    query: { refetchInterval: REFETCH_INTERVAL_MS },
  });

  const setFilter = (patch: { state?: JobState | undefined; queue?: string | undefined }) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch, page: undefined }),
    });
  };

  const goToPage = (target: number) => {
    void navigate({
      search: (prev) => ({ ...prev, page: target <= 1 ? undefined : target }),
    });
  };

  const totalPages = data?.totalPages ?? 1;
  const items = data?.items ?? [];
  const queues = stats?.queues ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <FilterSelect
            ariaLabel={t('filters.queueLabel')}
            allLabel={t('filters.all', { label: t('filters.queueLabel') })}
            value={queue}
            options={queues.map((q) => ({ id: q.name, label: q.name }))}
            onChange={(value) => {
              setFilter({ queue: value });
            }}
          />
          <FilterSelect
            ariaLabel={t('filters.stateLabel')}
            allLabel={t('filters.all', { label: t('filters.stateLabel') })}
            value={state}
            options={JOB_STATES.map((s) => ({ id: s, label: jobStateLabel(t, s) }))}
            onChange={(value) => {
              setFilter({ state: value as JobState | undefined });
            }}
          />
        </div>
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

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label={t('loadingLabel')} />
        </div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={t('table.ariaLabel')}>
              <Table.Header>
                <Table.Column isRowHeader>{t('table.queue')}</Table.Column>
                <Table.Column>{t('table.state')}</Table.Column>
                <Table.Column>{t('table.attempts')}</Table.Column>
                <Table.Column>{t('table.data')}</Table.Column>
                <Table.Column>{t('table.created')}</Table.Column>
                <Table.Column>{t('table.started')}</Table.Column>
                <Table.Column>{t('table.completed')}</Table.Column>
                <Table.Column>{t('table.output')}</Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((job) => (
                  <Table.Row key={job.id} id={job.id}>
                    <Table.Cell className="font-medium text-foreground">{job.name}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={stateColor[job.state]}>
                        {jobStateLabel(t, job.state)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {job.retryCount}/{job.retryLimit}
                    </Table.Cell>
                    <Table.Cell>
                      {job.data ? (
                        <code className="block max-w-56 truncate text-xs" title={job.data}>
                          {job.data}
                        </code>
                      ) : (
                        '—'
                      )}
                    </Table.Cell>
                    <Table.Cell>{formatDateTime(job.createdAt)}</Table.Cell>
                    <Table.Cell>{formatDateTime(job.startedAt)}</Table.Cell>
                    <Table.Cell>{formatDateTime(job.completedAt)}</Table.Cell>
                    <Table.Cell>
                      {job.output ? (
                        <span className="block max-w-56 truncate" title={job.output}>
                          {job.output}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {!isLoading && items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{t('empty')}</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          {t('common:pagination.summary', { total: data?.total ?? 0, page, totalPages })}
        </span>
        <Pagination>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={page <= 1}
                onPress={() => {
                  goToPage(page - 1);
                }}
              >
                <Pagination.PreviousIcon />
              </Pagination.Previous>
            </Pagination.Item>
            {pageItems(page, totalPages).map((item) =>
              typeof item === 'number' ? (
                <Pagination.Item key={item}>
                  <Pagination.Link
                    isActive={item === page}
                    onPress={() => {
                      goToPage(item);
                    }}
                  >
                    {item}
                  </Pagination.Link>
                </Pagination.Item>
              ) : (
                <Pagination.Item key={item}>
                  <Pagination.Ellipsis />
                </Pagination.Item>
              ),
            )}
            <Pagination.Item>
              <Pagination.Next
                isDisabled={page >= totalPages}
                onPress={() => {
                  goToPage(page + 1);
                }}
              >
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </div>
    </div>
  );
}
