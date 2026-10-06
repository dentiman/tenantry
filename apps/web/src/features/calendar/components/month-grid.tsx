import { TZDate } from '@date-fns/tz';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { dayKey, formatWeekday, isWeekend, todayKey } from '../lib/calendar-date';
import { EventChip } from './event-chip';
import type { EventIntent } from './event-context-menu';
import { allDaySpans, layoutSpans, type SpanLayout } from './layout-spans';
import { dayIndexAtPoint, monthDayShift, monthSlotCount } from './month-drag';
import { useEventDrag, type DragCommit, type DragMode } from './use-event-drag';

/**
 * Скільки плиток з часом показати, доки ряд не виміряний. Далі число рахується
 * від ФАКТИЧНОЇ висоти (`monthSlotCount`): на великому екрані під написом
 * «+2 more» стояло півклітинки порожнечі, на низькому — вміст вилазив за межу.
 */
const FALLBACK_PER_CELL = 3;

/** Висота доріжки багатоденної смуги (px) — та сама, що в рядку all-day тижня */
const SPAN_ROW_PX = 22;

/**
 * Ряд із числом дня — ФІКСОВАНОЇ висоти, а не `auto`: у тижні з «сьогодні»
 * бокс числа круглий (`size-5`) і тягне трек на кілька пікселів вище, через що
 * числа різних тижнів стояли на різній висоті.
 */
const DAY_HEAD_ROW_PX = 28;

interface MonthGridProps {
  days: TZDate[];
  events: CalendarEventResponse[];
  timeZone: string;
  /** Місяць, який зараз «свій»: дні добивки показуємо приглушено */
  anchorMonth: number;
  onSelect: (event: CalendarEventResponse) => void;
  onCreate: (startsAt: Date) => void;
  onShowDay: (key: string) => void;
  /** Дія з контекстного меню плитки; виконує сторінка */
  onIntent?: (event: CalendarEventResponse, intent: EventIntent) => void;
  /** Перетягування події на інший день; немає — плитки нерухомі */
  onDragCommit?: (commit: DragCommit) => void;
}

interface MonthWeek {
  days: TZDate[];
  /** Смуги all-day подій цього тижня */
  spans: SpanLayout;
  spanEvents: Map<string, CalendarEventResponse>;
  /** Події з часом — по днях, у своїй клітинці */
  timedByDay: Map<string, CalendarEventResponse[]>;
}

export function MonthGrid({
  days,
  events,
  timeZone,
  anchorMonth,
  onSelect,
  onCreate,
  onShowDay,
  onIntent,
  onDragCommit,
}: MonthGridProps) {
  const { t } = useTranslation('calendar');
  const today = todayKey(timeZone);
  const weekDays = days.slice(0, 7);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useEventDrag(timeZone, onDragCommit ?? (() => undefined), scrollRef);

  /**
   * Індекс дня в сітці — по ньому рахується зсув перетягування. Мапа, а не
   * пошук по масиву: у місяці 35 днів і до сотні плиток, а жест перераховує
   * зсув на кожен рух курсора.
   */
  const indexByDay = useMemo(
    () => new Map(days.map((day, index) => [dayKey(day, timeZone), index])),
    [days, timeZone],
  );

  /**
   * Початок перетягування. Зсув визначає клітинка ПІД КУРСОРОМ, а не піксельна
   * арифметика: ряди місяця бувають різної висоти (докладно — `month-drag.ts`).
   * Геометричний розрахунок лишається фолбеком для курсора поза сіткою.
   */
  const startDrag = (
    pointer: React.PointerEvent,
    event: CalendarEventResponse,
    dayIndex: number,
    mode: DragMode = 'move',
  ): void => {
    if (!onDragCommit) {
      return;
    }
    const grid = scrollRef.current;
    const cellWidth = grid ? grid.clientWidth / 7 : 0;
    const rowHeight = grid && weeks.length > 0 ? grid.clientHeight / weeks.length : 0;
    const origin = { x: pointer.clientX, y: pointer.clientY };

    drag.begin(
      pointer,
      {
        key: `${event.id}:${event.occurrenceStart}`,
        eventId: event.id,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      mode,
      (dx, dy) => {
        const target = dayIndexAtPoint(origin.x + dx, origin.y + dy);
        return {
          minutes: 0,
          dayShift:
            target === null ? monthDayShift(dx, dy, cellWidth, rowHeight) : target - dayIndex,
        };
      },
    );
  };

  /**
   * Місяць розкладається ТИЖНЯМИ, а не 42 незалежними клітинками: багатоденна
   * смуга не може перетнути межу рядка, тож кожен тиждень — власне вікно для
   * `allDaySpans`, і сегменти (`start`/`middle`/`end`) виходять самі з
   * обрізаності по краях цього вікна (docs/calendar.md §11.9).
   */
  const weeks = useMemo<MonthWeek[]>(() => {
    const result: MonthWeek[] = [];
    for (let offset = 0; offset < days.length; offset += 7) {
      const weekSlice = days.slice(offset, offset + 7);
      const { inputs, byId } = allDaySpans(events, weekSlice, timeZone);
      result.push({
        days: weekSlice,
        spans: layoutSpans(inputs),
        spanEvents: byId,
        timedByDay: groupTimed(events, weekSlice, timeZone),
      });
    }
    return result;
  }, [days, events, timeZone]);

  // Полотно, а не картка — див. той самий коментар у `TimeGrid`
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div
            key={dayKey(day, timeZone)}
            className="border-r py-2 text-center text-[11px] font-medium text-icon last:border-r-0"
          >
            {formatWeekday(day, timeZone)}
          </div>
        ))}
      </div>
      {/* Оверлейна смуга прокрутки — та сама, що в сітці дня/тижня: невидима,
          доки нею не користуються, і ширини в тижневих рядків не забирає */}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollRef}
        // `min-h-full`: тижневі рядки ділять висоту через `flex-1`, тож обгортка
        // вмісту мусить бути не нижчою за viewport
        contentClassName="flex min-h-full flex-col select-none"
      >
        {weeks.map((week, weekIndex) => (
          <MonthWeekRow
            key={dayKey(week.days[0] ?? days[0] ?? new TZDate(), timeZone)}
            week={week}
            weekIndex={weekIndex}
            dragPreview={drag.preview}
            indexByDay={indexByDay}
            onDragStart={onDragCommit ? startDrag : undefined}
            timeZone={timeZone}
            anchorMonth={anchorMonth}
            today={today}
            moreLabel={(count) => t('grid.more', { count })}
            createLabel={(date) => t('grid.createOn', { date })}
            onSelect={onSelect}
            onCreate={onCreate}
            onShowDay={onShowDay}
            onIntent={onIntent}
          />
        ))}
      </ScrollArea>
    </div>
  );
}

/**
 * Один тижневий рядок — ОДНА сітка з рядами: числа, доріжки смуг, плитки з
 * часом. Клітинок як цілісних боксів у розмітці немає: їхні межі й заливку
 * малює фоновий шар (сім елементів на всю висоту рядка), бо смуга мусить лежати
 * ПОВЕРХ кількох колонок, а вкладена в комірку вона обрізалась би.
 */
function MonthWeekRow({
  week,
  weekIndex,
  dragPreview,
  indexByDay,
  timeZone,
  anchorMonth,
  today,
  moreLabel,
  createLabel,
  onSelect,
  onCreate,
  onShowDay,
  onIntent,
  onDragStart,
}: {
  week: MonthWeek;
  /** Номер ряду в сітці місяця — по ньому hit-test визначає день під курсором */
  weekIndex: number;
  /** Активне перетягування: по ньому підсвічуємо цільову клітинку */
  dragPreview: { key: string; dayShift: number } | null;
  indexByDay: Map<string, number>;
  timeZone: string;
  anchorMonth: number;
  today: string;
  moreLabel: (count: number) => string;
  createLabel: (date: string) => string;
  onSelect: (event: CalendarEventResponse) => void;
  onCreate: (startsAt: Date) => void;
  onShowDay: (key: string) => void;
  onIntent?: (event: CalendarEventResponse, intent: EventIntent) => void;
  onDragStart?: (
    pointer: React.PointerEvent,
    event: CalendarEventResponse,
    dayIndex: number,
    mode?: DragMode,
  ) => void;
}) {
  const spanRows = week.spans.rows;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(0);

  /**
   * Висота ряду міряється, а не рахується: вона залежить і від висоти сітки, і
   * від кількості рядів, і від масштабу шрифту. `ResizeObserver` — щоб число
   * слотів перерахувалось на зміну розміру вікна, а не лишилось із монтування.
   */
  useEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setRowHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const perCell =
    rowHeight > 0
      ? monthSlotCount(rowHeight, DAY_HEAD_ROW_PX, spanRows, SPAN_ROW_PX)
      : FALLBACK_PER_CELL;

  /**
   * Куди приїде подія, яку зараз тягнуть. Підсвітка цільової клітинки — єдине
   * прев'ю, яке в місяці має сенс: плитка не може «поїхати» за курсором, бо в
   * новому дні її місце залежить від розкладки смуг того тижня, а мигання
   * плитки між клітинками читалось би як збій.
   */
  const dropColumn = (() => {
    if (!dragPreview) {
      return null;
    }
    // Ключ плитки — `${id}:${occurrenceStart}`, а ISO сам містить двокрапки,
    // тому ріжемо по ПЕРШІЙ
    const occurrenceStart = dragPreview.key.slice(dragPreview.key.indexOf(':') + 1);
    const fromIndex = indexByDay.get(dayKey(occurrenceStart, timeZone));
    if (fromIndex === undefined) {
      return null;
    }
    const target = fromIndex + dragPreview.dayShift;
    // Підсвічує лише той ряд, у який подія приїде
    return target >= weekIndex * 7 && target < weekIndex * 7 + 7 ? target % 7 : null;
  })();

  return (
    <div
      ref={rowRef}
      data-week-index={weekIndex}
      className="grid min-h-24 flex-1 grid-cols-7"
      style={{
        // Числа, далі доріжки смуг фіксованої висоти, останній `1fr` — плитки з
        // часом (саме він тягнеться, коли рядок вищий за вміст).
        //
        // Гілка без смуг ОБОВʼЯЗКОВА: `repeat(0, …)` — невалідне значення, і
        // браузер відкидає ВЕСЬ `grid-template-rows`, після чого числа їдуть у
        // середину рядка на неявних треках (спіймано в браузері: у тижнях без
        // all-day подій перший трек ставав 49px замість 28)
        gridTemplateRows:
          spanRows > 0
            ? `${String(DAY_HEAD_ROW_PX)}px repeat(${String(spanRows)}, ${String(SPAN_ROW_PX)}px) 1fr`
            : `${String(DAY_HEAD_ROW_PX)}px 1fr`,
      }}
    >
      {/* 1. Фон і межі клітинок — на всю висоту рядка */}
      {week.days.map((day, index) => (
        <div
          key={`bg-${dayKey(day, timeZone)}`}
          aria-hidden="true"
          style={{ gridColumn: index + 1, gridRow: '1 / -1' }}
          className={cn(
            'border-r border-b last:border-r-0',
            // Порядок важливий: «не цей місяць» перебиває підсвітку вихідних —
            // берег сітки не мусить конкурувати за увагу з її тілом
            isWeekend(day, timeZone) && 'bg-calendar-weekend',
            day.getMonth() !== anchorMonth && 'bg-calendar-weekend',
            // …а мішень перетягування перебиває все: поки жест триває, вона
            // єдине, що має значення
            dropColumn === index && 'bg-primary/10',
          )}
        />
      ))}

      {/* 2. Числа днів */}
      {week.days.map((day, index) => {
        const key = dayKey(day, timeZone);
        const isOtherMonth = day.getMonth() !== anchorMonth;
        return (
          <div
            key={`head-${key}`}
            style={{ gridColumn: index + 1, gridRow: 1 }}
            className="group/cell flex items-center justify-between px-1 py-1"
          >
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
              aria-label={createLabel(key)}
              onClick={() => {
                onCreate(
                  new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, timeZone),
                );
              }}
              className="rounded px-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover/cell:opacity-100 hover:opacity-100"
            >
              +
            </button>
          </div>
        );
      })}

      {/* 3. Багатоденні смуги — поверх колонок, у своїх доріжках */}
      {[...week.spans.slots].map(([key, slot]) => {
        const event = week.spanEvents.get(key);
        if (!event) {
          return null;
        }
        return (
          <div
            key={key}
            className="min-w-0 px-0.5"
            style={{
              // `gridColumnEnd` ексклюзивний, тому останній день додає одиницю
              gridColumn: `${String(slot.startIndex + 1)} / ${String(slot.endIndex + 2)}`,
              gridRow: slot.row + 2,
            }}
          >
            <EventChip
              event={event}
              timeZone={timeZone}
              segment={slot.segment}
              spanResize
              isDragging={dragPreview?.key === key}
              onDragStart={
                onDragStart
                  ? (pointer, mode) => {
                      // Тягнуть край — рахуємо від того краю, який тягнуть:
                      // інакше «кінець» зсувався б на різницю з ПОЧАТКОМ смуги
                      const anchorIndex = mode === 'resize-end' ? slot.endIndex : slot.startIndex;
                      onDragStart(pointer, event, weekIndex * 7 + anchorIndex, mode);
                    }
                  : undefined
              }
              onSelect={onSelect}
              onIntent={onIntent}
            />
          </div>
        );
      })}

      {/* 4. Події з часом — у своїй клітинці, під смугами */}
      {week.days.map((day, index) => {
        const key = dayKey(day, timeZone);
        const dayEvents = week.timedByDay.get(key) ?? [];
        // Останній слот віддається під сам напис «+N more», коли приховане є:
        // інакше він або накрив би плитку, або вимагав ще одного ряду
        const limit = dayEvents.length > perCell ? Math.max(perCell - 1, 1) : perCell;
        const visible = dayEvents.slice(0, limit);
        const hidden = dayEvents.length - visible.length;
        return (
          <div
            key={`timed-${key}`}
            style={{ gridColumn: index + 1, gridRowStart: -2 }}
            className="flex min-w-0 flex-col gap-0.5 px-1 pb-1"
          >
            {visible.map((event) => (
              <EventChip
                key={`${event.id}:${event.occurrenceStart}`}
                event={event}
                timeZone={timeZone}
                isDragging={dragPreview?.key === `${event.id}:${event.occurrenceStart}`}
                onDragStart={
                  onDragStart
                    ? (pointer) => {
                        onDragStart(pointer, event, weekIndex * 7 + index);
                      }
                    : undefined
                }
                onSelect={onSelect}
                onIntent={onIntent}
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
                {moreLabel(hidden)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Події з часом по днях. Багатоденні тут не розмножуються: подія, що перетинає
 * добу, у місяці однаково рідкість, і показати її в дні початку — точніше, ніж
 * дублювати в кожній клітинці (смугами йдуть тільки all-day).
 */
function groupTimed(
  events: readonly CalendarEventResponse[],
  days: readonly TZDate[],
  timeZone: string,
): Map<string, CalendarEventResponse[]> {
  const map = new Map<string, CalendarEventResponse[]>(
    days.map((day) => [dayKey(day, timeZone), []]),
  );
  for (const event of events) {
    if (event.allDay) {
      continue;
    }
    map.get(dayKey(event.occurrenceStart, timeZone))?.push(event);
  }
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) => new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime(),
    );
  }
  return map;
}
