import { useEffect, useMemo, useRef } from 'react';
import { TZDate } from '@date-fns/tz';
import { useTranslation } from 'react-i18next';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { cn } from '@saas-skeleton/ui/lib/utils';
import {
  dayKey,
  displayZoneFor,
  formatTime,
  formatWeekday,
  minutesFromDayStart,
  minutesInDay,
  todayKey,
} from '../../lib/calendar-date';
import { EventChip } from './event-chip';
import { layoutOverlaps, slotStyle, type OverlapInput } from './layout-overlaps';
import { useEventDrag, type DragCommit, type DragMode } from './use-event-drag';
import type { EventIntent } from './event-context-menu';
import { useRangeDraft, type RangeDraft } from './use-range-draft';

/**
 * Сітка дня/тижня. Власний компонент, а не зовнішня бібліотека календаря
 * (docs/calendar.md §11.4): готові приносять власний DOM і власну тему, а нам
 * потрібні дві сітки і функція розкладки — у наших токенах і з нашою мовою
 * даних (входження, а не «event source»).
 *
 * Висота години фіксована в px, а не у відсотках: доба переходу на зимовий час
 * має 25 годин, і відсоткова сітка того дня «стискала» б усі події.
 */
const HOUR_HEIGHT = 48;
/**
 * Нижче цієї тривалості плитка не вміщує двох рядків тексту (48px на годину →
 * 30 хв це 24px), тому час у ній не показуємо — лишається сама назва.
 */
const COMPACT_MINUTES = 45;
/**
 * Ширина жолоба годин. `4rem` (64px), а не стокові `3.5rem`: підпису «10:00 AM»
 * потрібно 49.1px тексту + 4px власного `px-0.5` + 6px відступу `right-1.5` =
 * 59.1px, і в 56px він не влазив — «10:00» лишалось на місці, а «AM» переїжджало
 * в наступний рядок (спіймано в браузері). Разом із `whitespace-nowrap` на
 * підписі це закриває і 12-годинні локалі, і 24-годинні (там підпис коротший).
 */
const HOUR_GUTTER = '4rem';
/** Те саме число в пікселях: арифметиці перенесення потрібна саме воно */
const HOUR_GUTTER_PX = 64;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

interface TimeGridProps {
  days: TZDate[];
  events: CalendarEventResponse[];
  timeZone: string;
  workDayStart: string;
  onSelect: (event: CalendarEventResponse) => void;
  /**
   * Створення по порожньому місцю. Клік дає лише початок (тривалість візьметься
   * з налаштувань), протягування — обидві межі: людина вже сказала, доки саме
   */
  onCreate: (startsAt: Date, endsAt?: Date) => void;
  /**
   * Перетягування завершено — сторінка застосовує зміну (оптимістично, з
   * відкатом і undo). Немає — сітка лишається нерухомою
   */
  onDragCommit?: (commit: DragCommit) => void;
  /** Дія з контекстного меню плитки; виконує сторінка (мутації, тости, підтвердження) */
  onIntent?: (event: CalendarEventResponse, intent: EventIntent) => void;
}

export function TimeGrid({
  days,
  events,
  timeZone,
  workDayStart,
  onSelect,
  onCreate,
  onDragCommit,
  onIntent,
}: TimeGridProps) {
  const { t } = useTranslation('calendar');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const today = todayKey(timeZone);

  const drag = useEventDrag(timeZone, onDragCommit ?? (() => undefined));

  /**
   * Створення протягуванням. День адресується ключем, а не індексом: колонки
   * перемальовуються при зміні періоду, а ключ лишається тим самим значенням,
   * яким сітка вже групує події.
   */
  const rangeDraft = useRangeDraft((created) => {
    const day = days.find((item) => dayKey(item, timeZone) === created.dayKey);
    if (!day) {
      return;
    }
    const dayStart = startOfDay(day, timeZone).getTime();
    onCreate(
      new Date(dayStart + created.startMinutes * 60_000),
      new Date(dayStart + created.endMinutes * 60_000),
    );
  });

  const beginRangeDraft = (pointer: React.PointerEvent<HTMLDivElement>, key: string, total: number): void => {
    // Натискання по плитці належить перенесенню, а не створенню
    if (pointer.target instanceof Element && pointer.target.closest('[data-calendar-chip]')) {
      return;
    }
    rangeDraft.begin(pointer, {
      dayKey: key,
      column: pointer.currentTarget,
      minutesInDay: total,
    });
  };

  /**
   * Геометрію міряємо на КОЖЕН pointerdown, а не тримаємо в стані: колонка
   * змінює ширину і від згортання сайдбара, і від ресайзу вікна, а застаріле
   * значення дало б перенос не в той день.
   */
  const measure = (): { hourHeight: number; columnWidth: number } => {
    const grid = gridRef.current;
    const columns = grid ? (grid.clientWidth - HOUR_GUTTER_PX) / days.length : 0;
    return { hourHeight: HOUR_HEIGHT, columnWidth: days.length > 1 ? columns : 0 };
  };

  const startDrag = (
    pointer: React.PointerEvent,
    event: CalendarEventResponse,
    mode: DragMode,
  ): void => {
    if (!onDragCommit) {
      return;
    }
    drag.begin(
      pointer,
      {
        key: `${event.id}:${event.occurrenceStart}`,
        eventId: event.id,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      mode,
      measure(),
    );
  };

  // Скрол до робочих годин при відкритті: без цього тиждень відкривається на
  // 00:00, і перше, що бачить людина, — порожня ніч
  useEffect(() => {
    const [hour] = workDayStart.split(':');
    const target = Math.max(Number.parseInt(hour ?? '9', 10) - 1, 0);
    scrollRef.current?.scrollTo({ top: target * HOUR_HEIGHT });
  }, [workDayStart]);

  const allDayByDay = useMemo(() => groupAllDay(events, days, timeZone), [events, days, timeZone]);
  const timedByDay = useMemo(() => groupTimed(events, days, timeZone), [events, days, timeZone]);
  const hasAllDay = [...allDayByDay.values()].some((list) => list.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      {/**
       * ОДНА сітка на шапку і на тіло, шапка — `sticky`.
       *
       * Раніше їх було дві: шапка поза скрол-контейнером, тіло всередині. Через
       * це смуга прокрутки (15px на macOS із «always show scrollbars») звужувала
       * ТІЛЬКИ тіло, і колонки розходились: 184.1px у шапці проти 182.0px у
       * тілі, тобто +2.1px на першій колонці і +15px до сьомої. Виглядало це як
       * «перший рядок з'їхав праворуч» — і легко списувалось на бейдж
       * сьогоднішнього дня, хоча треки `minmax(0, 1fr)` від вмісту не залежать
       * взагалі.
       *
       * Спільні треки роблять розходження неможливим за побудовою: смуга
       * прокрутки тепер зовні сітки і однаково впливає на обидва ряди. Перша
       * колонка — жолоб годин (`3.5rem`), далі дні.
       */}
      {/* `select-none`: протягування по сітці не має підсвічувати текст підписів
          годин — виділення читалось би як збій, а не як створення події */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto select-none">
        <div
          ref={gridRef}
          className="grid"
          style={{
            gridTemplateColumns: `${HOUR_GUTTER} repeat(${String(days.length)}, minmax(0, 1fr))`,
          }}
        >
          {/* Кут над жолобом: теж sticky і теж непрозорий, інакше крізь нього
              просвічували б години, що проїжджають під шапкою */}
          <div className="sticky top-0 z-20 border-r border-b bg-card" />
          {days.map((day) => {
            const key = dayKey(day, timeZone);
            const isToday = key === today;
            return (
              <div
                key={`head-${key}`}
                className="sticky top-0 z-20 border-r border-b bg-card last:border-r-0"
              >
                {/* Геометрія однакова в КОЖНІЙ комірці: бокс числа завжди
                    `size-6`, а «сьогодні» додає лише колір. Доки плитку мав
                    тільки поточний день, його комірка була на 4px вища (40
                    проти 36), а підпис дня стояв на 2px нижче за сусідів —
                    `items-baseline` рахує базову лінію flex-боксу інакше, ніж
                    текстового рядка. Тому й `items-center`: вирівнювання не
                    має залежати від того, що саме лежить у комірці */}
                <div className="flex items-center justify-center gap-1.5 py-2">
                  <span className="text-xs text-muted-foreground uppercase">
                    {formatWeekday(day, timeZone)}
                  </span>
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-sm font-medium',
                      isToday && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {hasAllDay && (
                  <div className="flex min-h-7 flex-col gap-0.5 border-t px-1 py-1">
                    {(allDayByDay.get(key) ?? []).map((event) => (
                      <EventChip
                        key={`${event.id}:${event.occurrenceStart}`}
                        event={event}
                        timeZone={timeZone}
                        onSelect={onSelect}
                        onIntent={onIntent}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Жолоб годин — той самий ряд сітки, що й колонки днів */}
          <div className="border-r">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative border-b text-right"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-1.5 bg-card px-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
                  {hour === 0 ? '' : formatHour(hour, timeZone)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = dayKey(day, timeZone);
            const dayEvents = timedByDay.get(key) ?? [];
            const total = minutesInDay(day, timeZone);
            const inputs: OverlapInput[] = dayEvents.map((event) => ({
              id: `${event.id}:${event.occurrenceStart}`,
              startMinutes: Math.max(minutesFromDayStart(event.occurrenceStart, timeZone), 0),
              endMinutes: clampEnd(event, day, timeZone, total),
            }));
            const slots = layoutOverlaps(inputs);

            return (
              <div
                key={`body-${key}`}
                className="relative border-r last:border-r-0"
                onPointerDown={(pointer) => {
                  beginRangeDraft(pointer, key, total);
                }}
              >
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={t('grid.createAt', { time: formatHour(hour, timeZone) })}
                    onClick={(clickEvent) => {
                      // Протягування завершується `pointerup`, який усе одно
                      // породжує клік по комірці, з якої почали: без цієї
                      // перевірки поруч із протягнутою подією створювалась би
                      // друга — на цілу годину.
                      //
                      // `detail > 0` обовʼязково: активація з КЛАВІАТУРИ дає
                      // клік без жодного pointer-жесту (`detail === 0`), і
                      // прапорець протягування, який лишився з попереднього
                      // жесту, проглинув би її — сітка перестала б працювати
                      // з Enter саме після перетягування мишею
                      if (clickEvent.detail > 0 && rangeDraft.consumeDragged()) {
                        return;
                      }
                      onCreate(
                        new TZDate(
                          day.getFullYear(),
                          day.getMonth(),
                          day.getDate(),
                          hour,
                          0,
                          timeZone,
                        ),
                      );
                    }}
                    className="block w-full border-b hover:bg-accent/40"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {rangeDraft.draft?.dayKey === key && (
                  <DraftBox
                    draft={rangeDraft.draft}
                    day={day}
                    timeZone={timeZone}
                    minutesInDay={total}
                  />
                )}
                {inputs.map((input, index) => {
                  const event = dayEvents[index];
                  const slot = slots.get(input.id);
                  if (!event || !slot) {
                    return null;
                  }
                  const isDragging = drag.preview?.key === input.id;
                  const geometry = measure();
                  return (
                    <EventChip
                      key={input.id}
                      event={event}
                      timeZone={timeZone}
                      variant="absolute"
                      compact={input.endMinutes - input.startMinutes < COMPACT_MINUTES}
                      style={{
                        ...slotStyle(input, slot, total),
                        // Прев'ю — `translate` поверх уже порахованої позиції:
                        // так плитка йде за курсором прилипаючи до 15 хв, і при
                        // цьому не треба перераховувати розкладку накладань
                        ...(isDragging && drag.preview
                          ? {
                              transform: `translate(${String(
                                drag.preview.dayShift * geometry.columnWidth,
                              )}px, ${String(
                                (drag.preview.mode === 'move' ? drag.preview.minutes : 0) /
                                  60 *
                                  HOUR_HEIGHT,
                              )}px)`,
                              height:
                                drag.preview.mode === 'resize'
                                  ? `calc(${slotStyle(input, slot, total).height} + ${String(
                                      (drag.preview.minutes / 60) * HOUR_HEIGHT,
                                    )}px)`
                                  : slotStyle(input, slot, total).height,
                            }
                          : {}),
                      }}
                      isDragging={isDragging}
                      onIntent={onIntent}
                      onDragStart={(pointer, mode) => {
                        startDrag(pointer, event, mode);
                      }}
                      onSelect={(selected, fromKeyboard) => {
                        // Після перенесення `pointerup` усе одно породжує клік —
                        // без цієї перевірки панель відкривалась би щоразу.
                        // Клавіатурна активація приходить із прапорцем і жест
                        // не перевіряє: хвостом перетягування вона бути не може
                        if (fromKeyboard || !drag.consumeDragged()) {
                          onSelect(selected);
                        }
                      }}
                    />
                  );
                })}
                {key === today && <NowLine timeZone={timeZone} minutesInDay={total} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Прямокутник чернетки — те, що людина бачить під курсором, доки тягне. Малюємо
 * САМІ, а не показуємо панель одразу: форма, що відкривається на першому ж
 * пікселі руху, приховала б сітку саме тоді, коли по ній ще вибирають час.
 *
 * Підпис — обидві межі: без нього прилипання до 15 хв лишається невидимим, і
 * людина не знає, що саме отримає, поки не відпустить.
 */
function DraftBox({
  draft,
  day,
  timeZone,
  minutesInDay: total,
}: {
  draft: RangeDraft;
  day: TZDate;
  timeZone: string;
  minutesInDay: number;
}) {
  const dayStart = startOfDay(day, timeZone).getTime();
  const from = new Date(dayStart + draft.startMinutes * 60_000);
  const to = new Date(dayStart + draft.endMinutes * 60_000);
  return (
    <div
      // `pointer-events-none` обовʼязково: інакше прямокутник, що зростає під
      // курсором, сам почав би ловити pointer-події і жест урвався б
      className="pointer-events-none absolute inset-x-0 z-20 rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-xs text-primary"
      style={{
        top: `${String((draft.startMinutes / total) * 100)}%`,
        height: `${String(((draft.endMinutes - draft.startMinutes) / total) * 100)}%`,
      }}
    >
      <span className="truncate">
        {formatTime(from, timeZone)} – {formatTime(to, timeZone)}
      </span>
    </div>
  );
}

/**
 * Лінія «зараз» рахується за КЛІЄНТСЬКИМ часом — і це нормально: вона показує,
 * де людина в своєму дні. Доставка нагадувань, навпаки, живе на серверному часі,
 * і це принципово (docs/calendar.md §12 п.14).
 */
function NowLine({ timeZone, minutesInDay: total }: { timeZone: string; minutesInDay: number }) {
  const { t } = useTranslation('calendar');
  const minutes = minutesFromDayStart(new Date(), timeZone);
  return (
    <div
      aria-label={t('grid.now')}
      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive"
      style={{ top: `${String((minutes / total) * 100)}%` }}
    >
      <span className="absolute -top-1 -left-1 size-2 rounded-full bg-destructive" />
    </div>
  );
}

function formatHour(hour: number, timeZone: string): string {
  // Формат 12/24 годин бере локаль — власного перемикача не заводимо
  return formatTime(new TZDate(2026, 0, 1, hour, 0, timeZone), timeZone);
}

/**
 * Багатоденна подія обрізається межею доби: у сітці вона малюється в кожному
 * своєму дні окремим фрагментом, а не однією плиткою через кілька колонок.
 */
function startOfDay(day: TZDate, timeZone: string): TZDate {
  return new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), timeZone);
}

function clampEnd(
  event: CalendarEventResponse,
  day: TZDate,
  timeZone: string,
  total: number,
): number {
  const dayStart = startOfDay(day, timeZone).getTime();
  const end = new Date(event.occurrenceEnd).getTime();
  const minutes = (end - dayStart) / 60_000;
  return Math.min(minutes, total);
}

function groupAllDay(
  events: CalendarEventResponse[],
  days: TZDate[],
  timeZone: string,
): Map<string, CalendarEventResponse[]> {
  const map = new Map<string, CalendarEventResponse[]>(days.map((day) => [dayKey(day, timeZone), []]));
  for (const event of events) {
    if (!event.allDay) {
      continue;
    }
    // All-day розкладається по датах у зоні ПОДІЇ (§6.2), тому день рахується
    // її зоною, а не зоною глядача
    const zone = displayZoneFor(event, timeZone);
    let cursor = new TZDate(new Date(event.occurrenceStart), zone);
    const end = new Date(event.occurrenceEnd).getTime();
    while (cursor.getTime() < end) {
      const key = dayKey(cursor, timeZone);
      map.get(key)?.push(event);
      cursor = new TZDate(cursor.getTime() + 86_400_000, zone);
    }
  }
  return map;
}

function groupTimed(
  events: CalendarEventResponse[],
  days: TZDate[],
  timeZone: string,
): Map<string, CalendarEventResponse[]> {
  const map = new Map<string, CalendarEventResponse[]>(days.map((day) => [dayKey(day, timeZone), []]));
  for (const event of events) {
    if (event.allDay) {
      continue;
    }
    const key = dayKey(event.occurrenceStart, timeZone);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(event);
    }
  }
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) => new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime(),
    );
  }
  return map;
}
