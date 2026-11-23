import { useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  DownloadIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { StepProgress } from '@saas-skeleton/ui/components/step-progress';
import { cn } from '@saas-skeleton/ui/lib/utils';
import {
  activityHeadline,
  useActivityStore,
  type ActivityHeadline,
  type ActivityItem,
} from '../lib/activity';

/**
 * Док активності — усе, що зараз виконується для користувача, панеллю в правому нижньому куті
 * робочої області (docs/frontend/app-shell.md §5.7; взірець — вікно завантажень Google Drive).
 * Приклеєний до нижнього краю, лежить ПОВЕРХ контенту й не зсуває сторінку. Читає лише реєстр
 * `lib/activity.ts`: хто дав елемент (черга завантажень, операція користувача), док не знає.
 *
 * Монтується всередині `SidebarInset`, тому його правий край — край робочої області: відкрита
 * контекстна панель чи асистент зсувають док лівіше, а не ховаються під ним.
 */
export function ActivityDock() {
  const items = useActivityStore((state) => state.items);
  const collapsed = useActivityStore((state) => state.collapsed);
  const setCollapsed = useActivityStore((state) => state.setCollapsed);
  const closeAll = useActivityStore((state) => state.closeAll);
  if (items.length === 0) {
    return null;
  }
  return (
    <ActivityDockView
      items={items}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onCloseAll={closeAll}
    />
  );
}

interface ActivityDockViewProps {
  items: readonly ActivityItem[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onCloseAll: () => void;
}

export function ActivityDockView({
  items,
  collapsed,
  onCollapsedChange,
  onCloseAll,
}: ActivityDockViewProps) {
  const { t } = useTranslation('layout');
  const [isConfirming, setConfirming] = useState(false);
  const headline = activityHeadline(items);

  const close = (): void => {
    // Закриття посеред роботи скасовує її — про це питаємо, як Drive («Cancel all uploads?»)
    if (headline.tone === 'active') {
      setConfirming(true);
    } else {
      onCloseAll();
    }
  };

  return (
    <>
      <section
        data-slot="activity-dock"
        aria-label={t('activity.title')}
        className={cn(
          // Приклеєний до низу: скруглення лише згори, нижньої межі немає. На вузькому екрані —
          // на всю ширину робочої області
          'absolute right-0 bottom-0 z-30 flex w-full flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-popover text-popover-foreground shadow-lg',
          'sm:right-6 sm:w-[22.5rem]',
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-1 bg-muted/60 pr-2 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" aria-live="polite">
            <ActivityHeadlineText headline={headline} />
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            // Без aria-expanded: ghost-кнопка фарбує його як «натиснуту», а стан уже названо підписом
            aria-label={collapsed ? t('activity.expand') : t('activity.collapse')}
            onClick={() => {
              onCollapsedChange(!collapsed);
            }}
          >
            <ChevronDownIcon className={cn('transition-transform', collapsed && 'rotate-180')} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('activity.close')} onClick={close}>
            <XIcon />
          </Button>
        </header>
        {collapsed ? null : (
          <ScrollArea className="max-h-72">
            <ul className="flex flex-col py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <ActivityRow item={item} />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </section>

      <AlertDialog open={isConfirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('activity.cancelAll.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('activity.cancelAll.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('activity.cancelAll.keep')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onCloseAll();
              }}
            >
              {t('activity.cancelAll.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ActivityHeadlineText({ headline }: { headline: ActivityHeadline }) {
  const { t } = useTranslation('layout');
  switch (headline.tone) {
    case 'active': {
      const text = headline.uploadsOnly
        ? t('activity.uploading', { count: headline.count })
        : t('activity.active', { count: headline.count });
      return headline.percent === null ? text : `${text} · ${String(headline.percent)}%`;
    }
    case 'failed':
      return t('activity.failed', { count: headline.count });
    case 'done':
      return headline.uploadsOnly
        ? t('activity.uploadsComplete', { count: headline.count })
        : t('activity.completed', { count: headline.count });
    case 'idle':
      return t('activity.title');
  }
}

/** Значок за розширенням назви: назва елемента — імʼя файлу і для завантаження, і для експорту */
function fileIcon(title: string): LucideIcon {
  const extension = title.includes('.') ? (title.split('.').pop() ?? '').toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) return ImageIcon;
  if (['csv', 'xlsx', 'xls'].includes(extension)) return FileSpreadsheetIcon;
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(extension)) return FileTextIcon;
  return FileIcon;
}

/** Кільце прогресу 20px; без відсотка — крутиться (робота йде, міряти нічим) */
function ProgressRing({ percent }: { percent: number | null }) {
  const radius = 8;
  const length = 2 * Math.PI * radius;
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn('size-5 -rotate-90', percent === null && 'animate-spin')}
      aria-hidden
    >
      <circle cx="10" cy="10" r={radius} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset]"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - (percent ?? 25) / 100)}
      />
    </svg>
  );
}

function StatusMark({ item, percent }: { item: ActivityItem; percent: number | null }) {
  switch (item.status) {
    case 'running':
      return <ProgressRing percent={percent} />;
    case 'queued':
      return <CircleDashedIcon aria-hidden className="size-5 text-icon-muted" />;
    case 'succeeded':
      return (
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground"
        >
          <CheckIcon className="size-3.5" />
        </span>
      );
    case 'failed':
      return <TriangleAlertIcon aria-hidden className="size-5 text-destructive" />;
    case 'canceled':
      return <CircleSlashIcon aria-hidden className="size-5 text-icon-muted" />;
  }
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const { t } = useTranslation('layout');
  const [isOpen, setOpen] = useState(false);
  const isActive = item.status === 'queued' || item.status === 'running';
  const hasSteps = item.steps !== undefined && item.steps.length > 0;
  const percent =
    item.progress && item.progress.total > 0
      ? Math.floor((Math.min(item.progress.current, item.progress.total) / item.progress.total) * 100)
      : null;
  const Icon = fileIcon(item.title);
  const statusText =
    item.status === 'failed' && item.errorMessage
      ? item.errorMessage
      : `${t(`activity.status.${item.status}`)}${
          item.status === 'running' && percent !== null ? ` · ${String(percent)}%` : ''
        }`;

  const name = (
    <>
      <span className="block truncate text-sm">{item.title}</span>
      {item.status === 'failed' || item.status === 'canceled' ? (
        <span
          className={cn(
            'block truncate text-xs',
            item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {statusText}
        </span>
      ) : (
        <span className="sr-only">{statusText}</span>
      )}
    </>
  );

  return (
    <div data-slot="activity-row" data-status={item.status} className="group/row px-2">
      <div className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 group-hover/row:bg-accent/60">
        <Icon aria-hidden className="size-5 shrink-0 text-icon" />
        {hasSteps ? (
          // Рядок із етапами розгортається кліком по назві — окремого шеврона немає, щоб рядок
          // лишався таким самим тихим, як у списку без етапів
          <button
            type="button"
            className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={item.title}
            aria-expanded={isOpen}
            aria-label={t('activity.toggleSteps', { title: item.title })}
            onClick={() => {
              setOpen((open) => !open);
            }}
          >
            {name}
          </button>
        ) : (
          <div className="min-w-0 flex-1" title={item.title}>
            {name}
          </div>
        )}

        {/* Стан і дії ділять одне місце: стан видно завжди, дії — під курсором, у фокусі й на
            дотикових екранах (там наведення немає) */}
        <div className="relative flex h-7 shrink-0 items-center justify-end">
          <div className="flex items-center group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:hidden">
            <StatusMark item={item} percent={percent} />
          </div>
          <div className="absolute right-0 hidden items-center group-focus-within/row:flex group-hover/row:flex pointer-coarse:static pointer-coarse:flex">
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
            {!isActive ? (
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
      </div>
      {hasSteps && isOpen ? (
        <StepProgress steps={item.steps ?? []} className="pt-1 pr-2 pb-3 pl-10" />
      ) : null}
    </div>
  );
}
