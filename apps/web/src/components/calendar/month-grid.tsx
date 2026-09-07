import { TZDate } from '@date-fns/tz';
import { useTranslation } from 'react-i18next';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { dayKey, displayZoneFor, formatWeekday, todayKey } from '../../lib/calendar-date';
import { EventChip } from './event-chip';

/** Скільки плиток показуємо в клітинці, решта — «+N more» */
const MAX_PER_CELL = 3;

interface MonthGridProps {
  days: TZDate[];
  events: CalendarEventResponse[];
  timeZone: string;
  /** Місяць, який зараз «свій»: дні добивки показуємо приглушено */
  anchorMonth: number;
  onSelect: (event: CalendarEventResponse) => void;
  onCreate: (startsAt: Date) => void;
  onShowDay: (key: string) => void;
}

export function MonthGrid({
  days,
  events,
  timeZone,
  anchorMonth,
  onSelect,
  onCreate,
  onShowDay,
}: MonthGridProps) {
  const { t } = useTranslation('calendar');
  const today = todayKey(timeZone);
  const byDay = groupByDay(events, days, timeZone);
  const weekDays = days.slice(0, 7);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div
            key={dayKey(day, timeZone)}
            className="border-r py-2 text-center text-xs text-muted-foreground uppercase last:border-r-0"
          >
            {formatWeekday(day, timeZone)}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridAutoRows: 'minmax(96px, 1fr)' }}
      >
        {days.map((day) => {
          const key = dayKey(day, timeZone);
          const dayEvents = byDay.get(key) ?? [];
          const visible = dayEvents.slice(0, MAX_PER_CELL);
          const hidden = dayEvents.length - visible.length;
          const isOtherMonth = day.getMonth() !== anchorMonth;

          return (
            <div
              key={key}
              className={cn(
                'flex min-w-0 flex-col gap-0.5 border-r border-b p-1 last:border-r-0',
                isOtherMonth && 'bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    onShowDay(key);
                  }}
                  className={cn(
                    'rounded px-1 text-xs font-medium hover:bg-accent',
                    isOtherMonth && 'text-muted-foreground',
                    key === today &&
                      'flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  {day.getDate()}
                </button>
                <button
                  type="button"
                  aria-label={t('grid.createOn', { date: key })}
                  onClick={() => {
                    onCreate(new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, timeZone));
                  }}
                  className="rounded px-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 hover:opacity-100"
                >
                  +
                </button>
              </div>
              {visible.map((event) => (
                <EventChip
                  key={`${event.id}:${event.occurrenceStart}`}
                  event={event}
                  timeZone={timeZone}
                  onSelect={onSelect}
                />
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onShowDay(key);
                  }}
                  className="px-1.5 text-left text-xs text-muted-foreground hover:underline"
                >
                  {t('grid.more', { count: hidden })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupByDay(
  events: CalendarEventResponse[],
  days: TZDate[],
  timeZone: string,
): Map<string, CalendarEventResponse[]> {
  const map = new Map<string, CalendarEventResponse[]>(
    days.map((day) => [dayKey(day, timeZone), []]),
  );
  for (const event of events) {
    const zone = displayZoneFor(event, timeZone);
    let cursor = new TZDate(new Date(event.occurrenceStart), zone);
    const end = new Date(event.occurrenceEnd).getTime();
    // Багатоденна подія потрапляє в КОЖНУ свою клітинку
    do {
      const key = dayKey(cursor, timeZone);
      map.get(key)?.push(event);
      cursor = new TZDate(cursor.getTime() + 86_400_000, zone);
    } while (cursor.getTime() < end);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      // All-day завжди зверху клітинки — вони стосуються всієї доби
      if (a.allDay !== b.allDay) {
        return a.allDay ? -1 : 1;
      }
      return new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime();
    });
  }
  return map;
}
