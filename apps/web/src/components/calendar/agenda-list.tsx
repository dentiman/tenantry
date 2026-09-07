import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from '@saas-skeleton/ui/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@saas-skeleton/ui/components/ui/item';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { useCalendarAgenda } from '../../api/generated/api';
import { dayKey, formatFullDate, formatTime } from '../../lib/calendar-date';

/**
 * Agenda — «що далі». Єдиний перегляд календаря, який ходить КУРСОРНИМ
 * ендпоінтом, а не вікном: у нескінченного фіда немає ні «сторінки 7», ні межі
 * «до якого числа» (docs/calendar.md §10).
 *
 * Механіка накопичення й лінивого довантаження — та сама, що в `ActivityFeed`:
 * маркер кінця в IntersectionObserver без `root`, спостерігач перестворюється на
 * кожен новий курсор.
 */
export function AgendaList({
  timeZone,
  onSelect,
}: {
  timeZone: string;
  onSelect: (event: CalendarEventResponse) => void;
}) {
  const { t } = useTranslation('calendar');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<CalendarEventResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useCalendarAgenda({ cursor, limit: 30 });

  useEffect(() => {
    if (!data) {
      return;
    }
    setItems((prev) => {
      if (cursor === undefined) {
        return data.items;
      }
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...data.items.filter((item) => !seen.has(item.id))];
    });
    setNextCursor(data.nextCursor);
  }, [data, cursor]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canLoadMore = nextCursor !== null && !isFetching;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canLoadMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setCursor(nextCursor);
        }
      },
      { rootMargin: '96px' },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, nextCursor]);

  if (isFetching && items.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={t('loading')} />
      </div>
    );
  }

  if (isError && items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyDescription className="text-destructive">{t('loadError')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyDescription>{t('agenda.empty')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Групування по днях робиться тут, а не на сервері: сервер віддає плоский фід,
  // а зона, у якій «день» починається, — властивість глядача
  let lastDay = '';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-lg border bg-card p-2">
      {items.map((event) => {
        const key = dayKey(event.occurrenceStart, timeZone);
        const isNewDay = key !== lastDay;
        lastDay = key;
        return (
          <div key={`${event.id}:${event.occurrenceStart}`}>
            {isNewDay && (
              <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                {formatFullDate(event.occurrenceStart, timeZone)}
              </p>
            )}
            <Item
              render={
                <button
                  type="button"
                  onClick={() => {
                    onSelect(event);
                  }}
                />
              }
              className="w-full text-left"
            >
              <ItemContent>
                <ItemTitle>{event.title}</ItemTitle>
                <ItemDescription>
                  {event.allDay
                    ? t('allDay')
                    : `${formatTime(event.occurrenceStart, timeZone)} – ${formatTime(event.occurrenceEnd, timeZone)}`}
                  {event.customer ? ` · ${event.customer.name}` : ''}
                </ItemDescription>
              </ItemContent>
              {event.myResponse === 'NEEDS_ACTION' && (
                <Badge variant="warning">{t('rsvp.pending')}</Badge>
              )}
            </Item>
          </div>
        );
      })}
      {nextCursor !== null && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          <Spinner aria-label={t('loadMore')} />
        </div>
      )}
    </div>
  );
}
