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
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindWindowQueryKey,
  useCalendarFindOne,
  useCalendarFindWindow,
  useCalendarUpdate,
} from '../api/generated/api';
import type { CalendarEventListResponseDtoOutput } from '../api/generated/model/calendarEventListResponseDtoOutput';
import type { DragCommit } from '../components/calendar/use-event-drag';
import { AgendaList } from '../components/calendar/agenda-list';
import { EventSheet, type EventSheetTarget } from '../components/calendar/event-sheet';
import { MonthGrid } from '../components/calendar/month-grid';
import { ShortcutsDialog } from '../components/calendar/shortcuts-dialog';
import { TimeGrid } from '../components/calendar/time-grid';
import { useCalendarPreferences } from '../components/calendar/use-calendar-preferences';
import { useCalendarHotkeys } from '../components/calendar/use-calendar-hotkeys';
import {
  CALENDAR_VIEWS,
  daysOfRange,
  defaultCreateStart,
  formatDateTime,
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
  const [isHelpOpen, setHelpOpen] = useState(false);

  // Параметри вікна лежать окремою змінною: ними ж адресується кеш при
  // оптимістичному патчі перетягування (`getCalendarFindWindowQueryKey`)
  const windowParams = {
    // Саме `toInstantIso`, а не `from.toISOString()`: `from` — це `TZDate`,
    // і його `toISOString` дає форму зі зсувом, яку контракт відхиляє
    from: toInstantIso(from),
    to: toInstantIso(to),
    includeCancelled: 'true' as const,
  };

  const { data, isPending, isError } = useCalendarFindWindow(
    windowParams,
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

  const queryClient = useQueryClient();
  const updateEvent = useCalendarUpdate();

  const refreshCalendar = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getCalendarFindWindowQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getCalendarAgendaQueryKey() }),
    ]);
  };

  /**
   * Перетягування завершено. Оптимістичний патч ОБОВʼЯЗКОВИЙ: без нього плитка
   * стрибала б назад і за 200 мс уперед, а перша ж 403-ка лишала б її «висіти»
   * в новому місці (docs/calendar.md §11.5 п.2).
   */
  const applyDragCommit = (commit: DragCommit): void => {
    const key = getCalendarFindWindowQueryKey(windowParams);
    const snapshot = queryClient.getQueryData<CalendarEventListResponseDtoOutput>(key);

    queryClient.setQueryData<CalendarEventListResponseDtoOutput>(key, (current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === commit.eventId
                ? {
                    ...item,
                    startsAt: commit.next.startsAt,
                    endsAt: commit.next.endsAt,
                    // Входження рухається разом із рядком: у V1 це те саме
                    occurrenceStart: commit.next.startsAt,
                    occurrenceEnd: commit.next.endsAt,
                  }
                : item,
            ),
          }
        : current,
    );

    void (async () => {
      try {
        await updateEvent.mutateAsync({
          id: commit.eventId,
          data: { startsAt: commit.next.startsAt, endsAt: commit.next.endsAt },
        });
        // Обʼєкт-тримач, а не `let`: id тоста потрібен усередині його ж
        // `onClick`, а посилатися на змінну до її присвоєння не можна
        const handle: { id?: string } = {};
        handle.id = toast.add({
          type: 'success',
          title: t(commit.mode === 'move' ? 'drag.moved' : 'drag.resized', {
            time: formatDateTime(commit.next.startsAt, timeZone),
          }),
          // `actionProps` — першокласна опція менеджера тостів Base UI, тож
          // undo не вимагав правок примітива. Повертає РІВНО ті межі, що були
          // до перетягування — вони приїхали в самому коміті
          actionProps: {
            children: t('drag.undo'),
            onClick: () => {
              // Закриваємо ОДРАЗУ: інакше тост лишається висіти з підписом
              // «Moved to …», який після відкату вже неправда (спіймано в
              // браузері)
              if (handle.id) {
                toast.close(handle.id);
              }
              void (async () => {
                await updateEvent.mutateAsync({
                  id: commit.eventId,
                  data: { startsAt: commit.startsAt, endsAt: commit.endsAt },
                });
                await refreshCalendar();
              })();
            },
          },
        });
      } catch {
        // Відкат: сервер не прийняв зміну, отже плитка мусить повернутись туди,
        // де була. Текст помилки покаже глобальний обробник мутацій
        queryClient.setQueryData(key, snapshot);
        toast.add({ type: 'error', title: t('drag.failed') });
      } finally {
        await refreshCalendar();
      }
    })();
  };

  /**
   * Відкрити форму на нову подію. `endsAt` приходить лише з протягування — коли
   * людина вже показала тривалість; клік дає тільки початок, і тоді довжину
   * бере налаштування організації
   */
  const openDraft = (startsAt: Date, endsAt?: Date): void => {
    setTarget({
      event: null,
      draft: {
        startsAt,
        endsAt:
          endsAt ?? new Date(startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000),
      },
    });
  };

  const goto = (nextView: CalendarView, nextAnchor: string): void => {
    void navigate({
      to: '/calendar/$view',
      params: { view: nextView },
      search: { date: nextAnchor },
    });
  };

  /**
   * Клавіші глушаться, доки відкрита панель події або довідка: усередині них
   * `W` і `N` — це літери, які людина набирає, а не команди календаря. Другий
   * запобіжник (фокус у полі) живе в самому хуку — модалка не єдиний спосіб
   * потрапити в інпут
   */
  useCalendarHotkeys(target === null && !isHelpOpen, (action) => {
    switch (action.kind) {
      case 'today':
        goto(view, todayKey(timeZone));
        break;
      case 'view':
        goto(action.view, anchor);
        break;
      case 'shift':
        goto(view, shiftAnchor(view, anchor, timeZone, action.direction));
        break;
      case 'create':
        // Без позиції курсора час бере те саме правило, що й кнопка тулбара
        openDraft(defaultCreateStart(anchor, timeZone, preferences.workDayStart));
        break;
      case 'help':
        setHelpOpen(true);
        break;
    }
  });

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
              openDraft(defaultCreateStart(anchor, timeZone, preferences.workDayStart));
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
          onCreate={openDraft}
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
          onCreate={openDraft}
          onDragCommit={applyDragCommit}
        />
      )}
      </div>

      <ShortcutsDialog
        isOpen={isHelpOpen}
        onClose={() => {
          setHelpOpen(false);
        }}
      />

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
