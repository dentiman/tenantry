import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityResponse } from '@saas-skeleton/contracts';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../components/ui/empty';
import { Spinner } from '../components/ui/spinner';
import { formatDateTime } from '../lib/format';
import { ActivityMessage } from './activity-message';

/** Мінімум, який стрічці треба від будь-якого джерела фіда */
export interface ActivityFeedQueryResult {
  data?: { items: ActivityResponse[]; nextCursor: string | null };
  isFetching: boolean;
  isError: boolean;
}

/**
 * Чим фетчити. Замикання, а НЕ готовий обʼєкт запиту — той самий патерн, що
 * `useListQuery` у DataGrid: воно викликається ЯК ХУК усередині компонента,
 * тому імʼя пропа мусить починатися з `use` (rules-of-hooks). `isEnabled` — уже
 * зведений прапорець (хост увімкнув і фід обрано): джерело передає його в `enabled`.
 */
export type UseActivityFeedQuery = (params: {
  cursor: string | undefined;
  isEnabled: boolean;
}) => ActivityFeedQueryResult;

interface ActivityFeedProps {
  /**
   * Ідентичність стрічки: зміна скидає накопичене (інша сутність, інший тенант).
   * null — нічого не обрано: стрічка не рендериться, запит вимкнено
   */
  feedKey: string | null;
  /** Драйвер вимикає запит, поки закритий; сторінка тримає його увімкненим */
  isEnabled?: boolean;
  useFeedQuery: UseActivityFeedQuery;
}

/**
 * Стрічка подій — ОДИН компонент на всі хости обох фронтів: драйвер і картки в
 * tenant-web, стрічка тенанта на картці в platform-web. Розводити їх у різні верстки
 * означало б розсинхрон при першій же зміні — той самий аргумент, що і в
 * `NotificationCard`. Джерела даних тут немає: кожен застосунок передає хук свого
 * згенерованого клієнта, тож бібліотека не знає жодного API.
 *
 * Курсорна пагінація з накопиченням items у локальному стані (useInfiniteQuery через
 * orval-конфіг — беклог). Довантаження **ліниве**: наступна сторінка летить, коли
 * маркер у кінці списку доходить до екрана, а не по кнопці. Спостерігач без `root`
 * (тобто відносно вʼюпорта) свідомо: стрічка живе і на сторінці, і у власному
 * скрол-контейнері картки — вкладений overflow браузер враховує сам, тож хост не
 * мусить передавати сюди свій контейнер.
 */
export function ActivityFeed({ feedKey, isEnabled = true, useFeedQuery }: ActivityFeedProps) {
  const { t } = useTranslation('activities');

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<ActivityResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useFeedQuery({
    cursor,
    isEnabled: isEnabled && feedKey !== null,
  });

  // Скидання накопичення при зміні сутності І при кожному вмиканні: компонент може
  // жити в дереві постійно (драйвер), тому без isEnabled у залежностях повторний
  // перегляд того самого юзера показував би накопичене з минулого разу — без подій,
  // що сталися між відкриттями
  useEffect(() => {
    setCursor(undefined);
    setEntries([]);
    setNextCursor(null);
  }, [feedKey, isEnabled]);

  // Перша сторінка ЗАМІНЮЄ накопичене, наступні — дописуються з дедупом по id.
  // Заміна принципова: свіжий фетч тієї ж сторінки (refetch, повторне відкриття)
  // мусить витіснити стару версію, а не бути проігнорованим як «уже змержена».
  // Дедуп заразом робить ефект ідемпотентним — StrictMode подвоює виклики.
  useEffect(() => {
    if (!data || feedKey === null) {
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
  }, [data, cursor, feedKey]);

  const isInitialLoading = isFetching && entries.length === 0;

  // Маркер кінця списку. Спостерігач перестворюється на КОЖНУ зміну `nextCursor`:
  // так наступна сторінка запитується рівно один раз на курсор, а поки триває
  // запит (`isFetching`) спостерігача немає взагалі — це і є захист від подвійної
  // подачі того самого курсора. Цикл сам зупиняється, коли список переростає
  // видиму область і маркер іде за її межі.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canLoadMore = nextCursor !== null && !isFetching;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    // `canLoadMore` заразом звужує `nextCursor` до рядка (aliased condition)
    if (!sentinel || !canLoadMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setCursor(nextCursor);
        }
      },
      // Невеликий запас: сторінка починає їхати трохи раніше, ніж людина
      // доскролила до самого низу, і скрол не смикається порожнечею
      { rootMargin: '96px' },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, nextCursor]);

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

      {nextCursor !== null && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          <Spinner aria-label={t('loadMore')} />
        </div>
      )}
    </div>
  );
}
