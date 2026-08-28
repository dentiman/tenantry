import { useEffect, useState } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { useTranslation } from 'react-i18next';
import { useActivitiesFindAll } from '../../api/generated/api';
import type { ActivityListResponseDtoOutputItemsItem } from '../../api/generated/model/activityListResponseDtoOutputItemsItem';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { ActivityMessage } from './activity-message';

type Activity = ActivityListResponseDtoOutputItemsItem;

interface ActivityFeedProps {
  entityType: string;
  /** null — сутність не обрана: запит не летить, стрічка не рендериться */
  entityId: string | null;
  /** Драйвер вимикає запит, поки закритий; сторінка тримає його увімкненим */
  isEnabled?: boolean;
}

/**
 * Стрічка подій сутності — ОДИН компонент на два хости: `ActivityDrawer` (швидкий
 * перегляд зі списку) і вкладка Activity на сторінці юзера. Розводити їх у дві
 * верстки означало б розсинхрон при першій же зміні — той самий аргумент, що і в
 * `NotificationCard`.
 *
 * Курсорна пагінація v1: кнопка «Load more» з накопиченням items у локальному стані
 * (useInfiniteQuery через orval-конфіг — беклог).
 */
export function ActivityFeed({ entityType, entityId, isEnabled = true }: ActivityFeedProps) {
  const { t } = useTranslation('activities');

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<Activity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useActivitiesFindAll(
    { entityType, entityId: entityId ?? '', cursor },
    { query: { enabled: isEnabled && entityId !== null } },
  );

  // Скидання накопичення при зміні сутності І при кожному вмиканні: компонент може
  // жити в дереві постійно (драйвер), тому без isEnabled у залежностях повторний
  // перегляд того самого юзера показував би накопичене з минулого разу — без подій,
  // що сталися між відкриттями
  useEffect(() => {
    setCursor(undefined);
    setEntries([]);
    setNextCursor(null);
  }, [entityId, entityType, isEnabled]);

  // Перша сторінка ЗАМІНЮЄ накопичене, наступні — дописуються з дедупом по id.
  // Заміна принципова: свіжий фетч тієї ж сторінки (refetch, повторне відкриття)
  // мусить витіснити стару версію, а не бути проігнорованим як «уже змержена».
  // Дедуп заразом робить ефект ідемпотентним — StrictMode подвоює виклики.
  useEffect(() => {
    if (!data || entityId === null) {
      return;
    }
    setEntries((prev) => {
      if (cursor === undefined) {
        return data.items;
      }
      const seen = new Set(prev.map((entry) => entry.id));
      return [...prev, ...data.items.filter((entry) => !seen.has(entry.id))];
    });
    setNextCursor(data.nextCursor);
  }, [data, cursor, entityId]);

  const isInitialLoading = isFetching && entries.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {isInitialLoading && (
        <div className="flex justify-center py-8">
          <Spinner aria-label={t('loading')} />
        </div>
      )}

      {isError && entries.length === 0 && (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle className="text-destructive">{t('loadError')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {!isInitialLoading && !isError && entries.length === 0 && (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyDescription>{t('empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {entries.length > 0 && (
        <ol className="flex flex-col gap-4">
          {entries.map((activity) => (
            <li key={activity.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
              <span className="text-sm text-foreground">
                <ActivityMessage activity={activity} />
              </span>
              <time className="text-xs text-muted-foreground" dateTime={activity.createdAt}>
                {formatDateTime(activity.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}

      {nextCursor && (
        <Button
          className="w-full"
          variant="secondary"
          disabled={isFetching}
          onClick={() => {
            setCursor(nextCursor);
          }}
        >
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}
