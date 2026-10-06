import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JobState } from '@saas-skeleton/contracts';
import {
  ContextPanelHeader,
  ContextPanelPortal,
} from '@saas-skeleton/ui/components/context-panel-slot';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import type { JobListResponseDtoOutputItemsItem } from '../../../api/generated/model/jobListResponseDtoOutputItemsItem';

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

/** Рядок «підпис → значення» — та сама форма, що на картці тенанта */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

function jobStateLabel(t: TFunction<'jobs'>, state: JobState): string {
  return t(`states.${state}`);
}

/**
 * Єдиний реальний споживач контекстної панелі в platform-web (крок 7 плану
 * шела): повний `data`/`output` — у гріді вони обрізані `max-w-56`.
 *
 * Метрика панелі — `p-2` (8px), не `p-6`: шапка бере `ContextPanelHeader`
 * (свій `px-2`), вміст тримає той самий відступ, щоб назва в шапці й ліва межа
 * вмісту стояли на одному піксельному стовпчику (`docs/frontend/app-shell.md` §5.6).
 *
 * Скролер вмісту — `ScrollArea` (вертикаль; горизонталь примітив глушить сам).
 * `<pre>` — `whitespace-pre-wrap break-all`, інакше довгий JSON розіпре колонку 288px.
 */
export function JobDetailsPanel({
  job,
  onClose,
}: {
  job: JobListResponseDtoOutputItemsItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('jobs');

  if (!job) {
    return null;
  }

  return (
    <ContextPanelPortal contentKey={job.id} label="JobDetailsPanel">
      <ContextPanelHeader title={job.name} description={job.id} onClose={onClose} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-2">
          <div>
            <Fact label={t('table.state')}>
              <Badge variant={stateVariant[job.state]}>{jobStateLabel(t, job.state)}</Badge>
            </Fact>
            <Fact label={t('table.attempts')}>
              {job.retryCount}/{job.retryLimit}
            </Fact>
            <Fact label={t('table.created')}>
              <DateTimeCell value={job.createdAt} />
            </Fact>
            <Fact label={t('table.started')}>
              <DateTimeCell value={job.startedAt} />
            </Fact>
            <Fact label={t('table.completed')}>
              <DateTimeCell value={job.completedAt} />
            </Fact>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('table.data')}</span>
            <pre className="min-w-0 rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-all">
              {job.data ?? '—'}
            </pre>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('table.output')}</span>
            <pre className="min-w-0 rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-all">
              {job.output ?? '—'}
            </pre>
          </div>
        </div>
      </ScrollArea>
    </ContextPanelPortal>
  );
}
