import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { Alert, AlertDescription, AlertTitle } from '@saas-skeleton/ui/components/ui/alert';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@saas-skeleton/ui/components/ui/toggle-group';
import { PageBreadcrumbs, type Crumb } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { useCalendarFindOne, useCalendarFindWindow } from '../api/generated/api';
import { AgendaList } from '../components/calendar/agenda-list';
import { EventSheet, type EventSheetTarget } from '../components/calendar/event-sheet';
import { MonthGrid } from '../components/calendar/month-grid';
import { TimeGrid } from '../components/calendar/time-grid';
import { useCalendarPreferences } from '../components/calendar/use-calendar-preferences';
import {
  CALENDAR_VIEWS,
  daysOfRange,
  formatRangeLabel,
  parseDayKey,
  shiftAnchor,
  toInstantIso,
  todayKey,
  viewRange,
  type CalendarView,
} from '../lib/calendar-date';

/**
 * Календар (docs/calendar.md §11). Перегляд і період живуть в URL, а не в стані:
 * F5, «назад» і надіслане колезі посилання дають ту саму картинку — та сама
 * доктрина, що в DataGrid і в `resolveArea`.
 */
export function CalendarPage() {
  const { t } = useTranslation('calendar');
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  // `strict: false` обовʼязково: цю саму сторінку рендерить і роут deep-link-а
  // `/calendar/events/$eventId`, де роуту `$view` у дереві матчів НЕМА — суворий
  // `from` кинув би там у рантаймі (компілятор цього не бачить)
  const search: { date?: string } = useSearch({ strict: false });
  const preferences = useCalendarPreferences();
  const timeZone = preferences.viewerTimeZone;

  const view = (params.view ?? 'week') as CalendarView;
  const anchor = search.date ?? todayKey(timeZone);
  const { from, to } = viewRange(view, anchor, timeZone, preferences.weekStartsOn);

  const [target, setTarget] = useState<EventSheetTarget | null>(null);

  const { data, isPending, isError } = useCalendarFindWindow(
    {
      // Саме `toInstantIso`, а не `from.toISOString()`: `from` — це `TZDate`,
      // і його `toISOString` дає форму зі зсувом, яку контракт відхиляє
      from: toInstantIso(from),
      to: toInstantIso(to),
      includeCancelled: 'true',
    },
    // Agenda ходить власним курсорним ендпоінтом — для неї вікно не потрібне.
    // `isReady` притримує запит до приходу дефолтів: без нього вікно рахується
    // в зоні ПРИСТРОЮ і після bootstrap-у перезапитується в зоні організації
    { query: { enabled: view !== 'agenda' && preferences.isReady } },
  );
  const events: CalendarEventResponse[] = data?.items ?? [];

  // Deep link `/calendar/events/:id` (з інбоксу, з журналу): подія відкривається
  // ПОВЕРХ сітки того тижня, у якому вона лежить
  const deepLinkId = params.eventId ?? null;
  const { data: linked } = useCalendarFindOne(deepLinkId ?? '', {
    query: { enabled: deepLinkId !== null },
  });
  useEffect(() => {
    if (linked) {
      setTarget({ event: linked });
    }
  }, [linked]);

  const goto = (nextView: CalendarView, nextAnchor: string): void => {
    void navigate({
      to: '/calendar/$view',
      params: { view: nextView },
      search: { date: nextAnchor },
    });
  };

  const crumbs: Crumb[] = [{ label: t('title') }];
  const days = daysOfRange(from, to, timeZone);
  const anchorMonth = parseDayKey(anchor, timeZone).getMonth();

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumbs items={crumbs} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              goto(view, todayKey(timeZone));
            }}
          >
            {t('toolbar.today')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('toolbar.previous')}
            onClick={() => {
              goto(view, shiftAnchor(view, anchor, timeZone, -1));
            }}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('toolbar.next')}
            onClick={() => {
              goto(view, shiftAnchor(view, anchor, timeZone, 1));
            }}
          >
            <ChevronRightIcon />
          </Button>
          <h1 className="text-base font-medium">
            {view === 'agenda'
              ? t('toolbar.upcoming')
              : formatRangeLabel(view, anchor, from, to, timeZone)}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <ToggleGroup
            value={[view]}
            onValueChange={(next: string[]) => {
              const chosen = next[0];
              // Порожній масив = повторний клік по активному: перегляд лишається
              if (chosen) {
                goto(chosen as CalendarView, anchor);
              }
            }}
          >
            {CALENDAR_VIEWS.map((item) => (
              <ToggleGroupItem key={item} value={item} aria-label={t(`view.${item}`)}>
                {t(`view.${item}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            size="sm"
            onClick={() => {
              setTarget({ event: null });
            }}
          >
            <PlusIcon />
            {t('toolbar.create')}
          </Button>
        </div>
      </div>

      {/* Зона видна ЗАВЖДИ — найдешевший спосіб не отримати «я прийшов не в той
          час»; банер зʼявляється лише коли профільна зона розходиться з зоною
          пристрою (докладно — docs/calendar.md §11.5 п.10) */}
      {preferences.isDeviceZoneDifferent && (
        <Alert>
          <AlertTitle>{t('zoneBanner.title', { zone: timeZone })}</AlertTitle>
          <AlertDescription>
            {t('zoneBanner.hint')}{' '}
            <Link to="/user-settings" className="underline">
              {t('zoneBanner.action')}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>{t('loadError')}</AlertTitle>
        </Alert>
      )}

      {/* Висота задається ТУТ, а не `flex-1`: шел скролить вікно (усі інші
          сторінки на це і розраховані), тому сітка мусить обмежити себе сама —
          той самий ідіом, що в `ActivityPanel`. `min-h` лишає її придатною на
          низькому екрані, де calc дав би кілька сантиметрів.

          Скелет рівно на висоту сітки, а не спінер по центру: інакше розкладка
          стрибає на кожному переході між тижнями */}
      <div className="flex h-[calc(100vh-15rem)] min-h-[28rem] flex-col">
      {isPending && view !== 'agenda' ? (
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      ) : view === 'agenda' ? (
        <AgendaList
          timeZone={timeZone}
          onSelect={(event) => {
            setTarget({ event });
          }}
        />
      ) : view === 'month' ? (
        <MonthGrid
          days={days}
          events={events}
          timeZone={timeZone}
          anchorMonth={anchorMonth}
          onSelect={(event) => {
            setTarget({ event });
          }}
          onCreate={(startsAt) => {
            setTarget({
              event: null,
              draft: {
                startsAt,
                endsAt: new Date(
                  startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000,
                ),
              },
            });
          }}
          onShowDay={(key) => {
            goto('day', key);
          }}
        />
      ) : (
        <TimeGrid
          days={days}
          events={events}
          timeZone={timeZone}
          workDayStart={preferences.workDayStart}
          onSelect={(event) => {
            setTarget({ event });
          }}
          onCreate={(startsAt) => {
            setTarget({
              event: null,
              draft: {
                startsAt,
                endsAt: new Date(
                  startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000,
                ),
              },
            });
          }}
        />
      )}
      </div>

      <EventSheet
        target={target}
        timeZone={timeZone}
        defaultDurationMinutes={preferences.defaultEventDurationMinutes}
        defaultReminderMinutes={preferences.defaultReminderMinutes}
        onClose={() => {
          setTarget(null);
          // Deep link відпрацював — прибираємо його з URL, щоб «назад» не
          // відкривав панель знову
          if (deepLinkId) {
            void navigate({
              to: '/calendar/$view',
              params: { view: 'week' },
              search: { date: todayKey(timeZone) },
              replace: true,
            });
          }
        }}
      />
    </div>
  );
}
