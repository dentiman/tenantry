import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { Alert, AlertTitle } from '@saas-skeleton/ui/components/ui/alert';
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
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindWindowQueryKey,
  useCalendarFindOne,
  useCalendarFindWindow,
  useCalendarRemove,
  useCalendarSetRsvp,
  useCalendarSetStatus,
  useCalendarUpdate,
} from '../api/generated/api';
import type { CalendarEventListResponseDtoOutput } from '../api/generated/model/calendarEventListResponseDtoOutput';
import type { DragCommit } from '../components/calendar/use-event-drag';
import type { EventIntent } from '../components/calendar/event-context-menu';
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
  const setStatus = useCalendarSetStatus();
  const setRsvp = useCalendarSetRsvp();
  const removeEvent = useCalendarRemove();
  /** Подія, для якої відкрито підтвердження видалення (null — діалог закритий) */
  const [pendingDelete, setPendingDelete] = useState<CalendarEventResponse | null>(null);

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

  /**
   * Дії контекстного меню плитки. Виконує СТОРІНКА, а не плитка: кожна з них —
   * мутація з тостом, а видалення ще й із підтвердженням, і тримати це в кожній
   * з тридцяти плиток на екрані означало б тридцять копій того самого стану.
   *
   * Видалення тут єдине, що не робиться одразу: скасування (`cancel`) зворотне
   * і лишає історію, а `DELETE` — ні, тому воно проходить через той самий
   * `alert-dialog`, що й у панелі події.
   */
  const applyIntent = (event: CalendarEventResponse, intent: EventIntent): void => {
    switch (intent.kind) {
      case 'open':
        setTarget({ event });
        return;
      case 'duplicate':
        // Копія відкривається ФОРМОЮ, а не створюється тихо: у дубліката майже
        // завжди міняють час або назву, і зберегти його одним кліком означало б
        // отримати другу однакову зустріч у тому самому слоті
        setTarget({
          event: null,
          draft: {
            startsAt: new Date(event.startsAt),
            endsAt: new Date(event.endsAt),
            template: event,
          },
        });
        return;
      case 'delete':
        setPendingDelete(event);
        return;
      case 'cancel':
      case 'restore':
        void runIntent(
          setStatus.mutateAsync({
            id: event.id,
            data: { status: intent.kind === 'cancel' ? 'CANCELLED' : 'CONFIRMED' },
          }),
          t(intent.kind === 'cancel' ? 'menu.cancelled' : 'menu.restored'),
        );
        return;
      case 'rsvp':
        void runIntent(
          setRsvp.mutateAsync({ id: event.id, data: { response: intent.response } }),
          t('menu.rsvpSaved'),
        );
        return;
    }
  };

  /**
   * Спільний хвіст усіх дій меню: успіх — тост і перечитування, помилку показує
   * глобальний обробник мутацій (той самий контракт, що в решті застосунку).
   * Оптимістичного патчу тут свідомо немає: на відміну від перетягування, плитка
   * не рухається під курсором, тож затримка в 200 мс нічого не ламає
   */
  const runIntent = async (mutation: Promise<unknown>, message: string): Promise<void> => {
    try {
      await mutation;
      toast.add({ type: 'success', title: message });
    } finally {
      await refreshCalendar();
    }
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
      case 'shift':
        // В агенді періоду не існує: фід курсорний і завжди починається від
        // «зараз», тому `T` і стрілки там не мають чого зсувати. Мовчазний
        // no-op, а не зсув `?date=`, який нічого не змінює на екрані — той
        // самий аргумент, що прибрав ці кнопки з тулбара (docs/calendar.md §11.8)
        if (view !== 'agenda') {
          goto(
            view,
            action.kind === 'today'
              ? todayKey(timeZone)
              : shiftAnchor(view, anchor, timeZone, action.direction),
          );
        }
        break;
      case 'view':
        goto(action.view, anchor);
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

  const days = daysOfRange(from, to, timeZone);
  const anchorMonth = parseDayKey(anchor, timeZone).getMonth();

  return (
    // Роут у режимі `bleed` (див. StaticDataRouteOption): полів шела немає, і
    // сторінка роздає їх сама — сітці не дає жодних, бо вона полотно, а Alert
    // і agenda отримують власні
    <div className="flex flex-col">
      {/* Тулбар періоду живе В ХЕДЕРІ шела, а не над сіткою (2026-09-08).
          Календар — єдина сторінка, чия ліва зона хедера не крихти: «де я» тут
          виражає не назва розділу (вона й так стоїть у колонці area), а ПЕРІОД,
          яким ці ж кнопки й керують. Портал лишає тулбар дитиною сторінки, тож
          `goto` і `openDraft` дістаються до її стану без підняття вгору */}
      <PageHeader
        label="CalendarPage"
        actions={
          <>
            {/* Таби — ті самі, що на картці кастомера (Overview | Contacts):
                перемикач виглядів це РОЗДІЛИ одного екрана, а не набір
                незалежних перемикачів, яким був `ToggleGroup`.
                Контрольований URL-ом: `TabsContent` тут немає навмисно — сітку
                малює сторінка нижче, бо вона важка і залежить від даних вікна */}
            <Tabs
              value={view}
              onValueChange={(next) => {
                goto(next as CalendarView, anchor);
              }}
            >
              <TabsList size="sm">
                {CALENDAR_VIEWS.map((item) => (
                  <TabsTrigger key={item} value={item}>
                    {t(`view.${item}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {/* `sm` (32px), а не дефолтні 36: у хедері шела кнопка стоїть в
                одному ряду з дзвінком і перемикачем теми, і повна метрика
                контрола робила б її на голову вищою за сусідів */}
            <Button
              size="sm"
              onClick={() => {
                openDraft(defaultCreateStart(anchor, timeZone, preferences.workDayStart));
              }}
            >
              <PlusIcon />
              {t('toolbar.create')}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-1">
          {/* «Today» і стрілки керують ПЕРІОДОМ, а періоду в агенді немає:
              фід курсорний і завжди починається від «зараз», тож у цьому
              перегляді кнопки не робили нічого (docs/calendar.md §11.8).
              Мертвий контрол гірший за відсутній — він обіцяє дію */}
          {view !== 'agenda' && (
            <>
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
                size="icon-sm"
                aria-label={t('toolbar.previous')}
                onClick={() => {
                  goto(view, shiftAnchor(view, anchor, timeZone, -1));
                }}
              >
                <ChevronLeftIcon />
              </Button>
              {/* Заголовок періоду стоїть МІЖ стрілками: вони керують саме ним,
                  і поставлений збоку він змушував очі стрибати «кнопка →
                  результат → кнопка».

                  `min-w-40` — це резерв рівно під ЗВИЧАЙНИЙ підпис
                  («September 2026»), а не під найдовший можливий. Довші
                  випадки є — тиждень через межу місяців дає
                  «September 2026 — October 2026», день дає
                  «Wednesday, September 30, 2026», — і на них бокс просто
                  РОСТЕ, розсуваючи стрілки. Резервувати ширину під них
                  постійно означало б тримати 10rem порожнечі навколо підпису в
                  усі інші дні року. `text-center` + `tabular-nums` лишаються:
                  вони прибирають сіпання цифр усередині одного формату. */}
              <h1 className="min-w-40 text-center text-sm font-medium tabular-nums">
                {formatRangeLabel(view, anchor, from, to, timeZone)}
              </h1>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('toolbar.next')}
                onClick={() => {
                  goto(view, shiftAnchor(view, anchor, timeZone, 1));
                }}
              >
                <ChevronRightIcon />
              </Button>
            </>
          )}
          {view === 'agenda' && <h1 className="text-sm font-medium">{t('toolbar.upcoming')}</h1>}
        </div>
      </PageHeader>

      {isError && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertTitle>{t('loadError')}</AlertTitle>
        </Alert>
      )}

      {/* Висота задається ТУТ, а не `flex-1`: шел скролить вікно (усі інші
          сторінки на це і розраховані), тому сітка мусить обмежити себе сама —
          той самий ідіом, що в `ActivityPanel`. `min-h` лишає її придатною на
          низькому екрані, де calc дав би кілька сантиметрів.

          Скелет рівно на висоту сітки, а не спінер по центру: інакше розкладка
          стрибає на кожному переході між тижнями */}
      {/* 3.5rem = рівно хедер шела: відступів контенту більше немає (`bleed`),
          тож сітка займає весь залишок вікна. Було 10rem із власним тулбаром і
          6rem — після його переїзду в хедер (обидва того ж дня, 2026-09-08) */}
      <div className="flex h-[calc(100vh-3.5rem)] min-h-[28rem] flex-col">
        {isPending && view !== 'agenda' ? (
          <Skeleton className="min-h-0 flex-1 rounded-none" />
        ) : view === 'agenda' ? (
          // Агенда — СПИСОК карток, а не сітка: полотном вона не є, тож поля їй
          // потрібні так само, як будь-якому списку
          <div className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-6">
            <AgendaList
              timeZone={timeZone}
              onSelect={(event) => {
                setTarget({ event });
              }}
              onCreate={() => {
                openDraft(defaultCreateStart(anchor, timeZone, preferences.workDayStart));
              }}
              onIntent={applyIntent}
            />
          </div>
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
            onIntent={applyIntent}
            onDragCommit={applyDragCommit}
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
            onEdgeNavigate={(direction) => {
              goto(view, shiftAnchor(view, anchor, timeZone, direction));
            }}
            onIntent={applyIntent}
          />
        )}
      </div>

      {/* Підтвердження видалення живе на СТОРІНЦІ, поруч із обробником інтентів:
          плитка про нього не знає, а діалог у застосунку один, а не по одному
          на кожну подію в сітці */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('menu.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('menu.deleteHint', { title: pendingDelete?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('menu.deleteCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const event = pendingDelete;
                setPendingDelete(null);
                if (event) {
                  void runIntent(removeEvent.mutateAsync({ id: event.id }), t('menu.deleted'));
                }
              }}
            >
              {t('menu.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
