import type { JobResponse, JobState, QueueStat } from '@saas-skeleton/contracts';
import type { JobRow } from './jobs.service';

export function toJobResponse(row: JobRow): JobResponse {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    retryCount: row.retry_count,
    retryLimit: row.retry_limit,
    singletonKey: row.singleton_key,
    createdAt: row.created_on.toISOString(),
    startedAt: row.started_on ? row.started_on.toISOString() : null,
    completedAt: row.completed_on ? row.completed_on.toISOString() : null,
    data: row.data == null ? null : JSON.stringify(row.data),
    output: row.output == null ? null : JSON.stringify(row.output),
  };
}

const EMPTY_COUNTS: Omit<QueueStat, 'name'> = {
  created: 0,
  retry: 0,
  active: 0,
  completed: 0,
  cancelled: 0,
  failed: 0,
  total: 0,
};

export function toQueueStats(
  rows: { name: string; state: JobState; count: number }[],
): QueueStat[] {
  const byName = new Map<string, QueueStat>();
  for (const row of rows) {
    const stat = byName.get(row.name) ?? { name: row.name, ...EMPTY_COUNTS };
    stat[row.state] += row.count;
    stat.total += row.count;
    byName.set(row.name, stat);
  }
  return [...byName.values()];
}
