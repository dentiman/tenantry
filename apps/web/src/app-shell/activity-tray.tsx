import {
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@saas-skeleton/ui/components/ui/collapsible';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@saas-skeleton/ui/components/ui/popover';
import { Progress } from '@saas-skeleton/ui/components/ui/progress';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { StepProgress } from '@saas-skeleton/ui/components/step-progress';
import {
  summarizeActivity,
  useActivityStore,
  type ActivityItem,
  type ActivitySummary,
} from '../lib/activity';

/**
 * Лоток активності — одне місце в шелі для всього, що зараз виконується для користувача
 * (docs/frontend/app-shell.md). Читає лише реєстр `lib/activity.ts`: хто саме дав елемент
 * (черга завантажень, згодом серверна операція), лоток не знає.
 *
 * Стоїть у хедері, а не в нижній смузі сайдбара: та ховається разом зі згорнутим сайдбаром,
 * а індикатор роботи мусить лишатися на очах. Порожній — не малює нічого.
 */
export function ActivityTray() {
  const items = useActivityStore((state) => state.items);
  if (items.length === 0) {
    return null;
  }
  return <ActivityTrayView items={items} />;
}

export function ActivityTrayView({ items }: { items: readonly ActivityItem[] }) {
  const { t } = useTranslation('layout');
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5 tabular-nums" data-slot="activity-chip" />
        }
      >
        <ActivityChipContent summary={summarizeActivity(items)} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 p-0">
        <PopoverHeader className="border-b px-3 py-2.5">
          <PopoverTitle>{t('activity.title')}</PopoverTitle>
        </PopoverHeader>
        <ScrollArea className="max-h-96">
          <ul className="flex flex-col divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <ActivityRow item={item} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Режими чипа: щось виконується → кількість і спільний відсоток; лишилися помилки → увага;
 * лишилося успішно завершене → галочка; лишилися тільки скасовані → назва лотка.
 */
export function ActivityChipContent({ summary }: { summary: ActivitySummary }) {
  const { t } = useTranslation('layout');
  if (summary.active > 0) {
    return (
      <>
        <Spinner aria-hidden role="presentation" className="size-3.5" />
        <span>
          {t('activity.active', { count: summary.active })}
          {summary.percent !== null && ` · ${String(summary.percent)}%`}
        </span>
      </>
    );
  }
  if (summary.failed > 0) {
    return (
      <>
        <TriangleAlertIcon aria-hidden className="text-destructive" />
        <span>{t('activity.failed', { count: summary.failed })}</span>
      </>
    );
  }
  if (summary.succeeded > 0) {
    return (
      <>
        <CheckIcon aria-hidden className="text-icon" />
        <span>{t('activity.done')}</span>
      </>
    );
  }
  // Лишилися тільки скасовані: «готово» тут збрехало б — просто назва лотка
  return (
    <>
      <ListIcon aria-hidden className="text-icon" />
      <span>{t('activity.title')}</span>
    </>
  );
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const { t } = useTranslation('layout');
  const isActive = item.status === 'queued' || item.status === 'running';
  const hasSteps = item.steps !== undefined && item.steps.length > 0;
  const percent =
    item.progress && item.progress.total > 0
      ? Math.floor((Math.min(item.progress.current, item.progress.total) / item.progress.total) * 100)
      : null;

  return (
    <Collapsible data-slot="activity-row" data-status={item.status} className="px-3 py-2.5">
      <div className="flex items-start gap-1.5">
        {hasSteps ? (
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="-ml-1.5 shrink-0 data-panel-open:[&_svg]:rotate-90"
                aria-label={t('activity.toggleSteps', { title: item.title })}
              />
            }
          >
            <ChevronRightIcon className="transition-transform" />
          </CollapsibleTrigger>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.title}>
            {item.title}
          </p>
          <p
            className={
              item.status === 'failed'
                ? 'mt-0.5 text-xs text-destructive'
                : 'mt-0.5 text-xs text-muted-foreground'
            }
          >
            {item.status === 'failed' && item.errorMessage
              ? item.errorMessage
              : t(`activity.status.${item.status}`)}
            {isActive && percent !== null && item.status === 'running' && ` · ${String(percent)}%`}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {item.action ? (
            <Button variant="ghost" size="xs" onClick={item.action.run}>
              <DownloadIcon />
              {item.action.label}
            </Button>
          ) : null}
          {item.onRetry ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('activity.retry', { title: item.title })}
              onClick={item.onRetry}
            >
              <RotateCwIcon />
            </Button>
          ) : null}
          {isActive && item.onCancel ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('activity.cancel', { title: item.title })}
              onClick={item.onCancel}
            >
              <XIcon />
            </Button>
          ) : null}
          {!isActive && (item.status !== 'succeeded' || item.action) ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('activity.dismiss', { title: item.title })}
              onClick={item.onDismiss}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </div>
      {isActive ? (
        // value={null} — індетермінований стан Base UI: елемент у черзі або без вимірюваного прогресу
        <Progress
          className="mt-2"
          value={item.status === 'running' ? percent : null}
          aria-label={item.title}
        />
      ) : null}
      {hasSteps ? (
        <CollapsibleContent>
          <StepProgress steps={item.steps ?? []} className="mt-3 pl-1" />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
