import { TZDate } from '@date-fns/tz';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { dayKey, displayZoneFor } from '../lib/calendar-date';

/**
 * Розкладка БАГАТОДЕННИХ смуг (all-day і подій, що перетинають добу).
 *
 * Друга чиста функція розкладки після `layoutOverlaps` — і задача в неї
 * дзеркальна: та ділить одну добу по вертикалі (колонки в межах дня), ця
 * ділить вікно днів по горизонталі (доріжки, у яких смуги не налазять).
 *
 * Чому доріжки, а не «подія на день»: до цього all-day подія на три дні
 * малювалась трьома окремими плитками в трьох колонках, і «відпустка 14–16»
 * читалась як три різні відпустки. Смуга — одна на подію в межах вікна.
 *
 * Вікном може бути і тиждень (`TimeGrid`), і ОДИН РЯДОК місяця (`MonthGrid`) —
 * саме тому різання по тижнях тут не робиться: кожен рядок питає свою розкладку,
 * а обрізаність по краях вікна повертається прапорцями `segment`.
 */

export interface SpanInput {
  id: string;
  /** Перший день вікна, який займає подія (індекс у масиві днів) */
  startIndex: number;
  /** Останній день, ВКЛЮЧНО */
  endIndex: number;
  /** Подія почалась ДО вікна */
  clippedStart: boolean;
  /** Подія триває ПІСЛЯ вікна */
  clippedEnd: boolean;
}

/**
 * Де саме обрізана смуга — від цього залежать закруглення кутів: у частини, що
 * триває далі, край рівний, і око читає «продовжується».
 */
export type SpanSegment = 'full' | 'start' | 'middle' | 'end';

export interface SpanSlot {
  /** Доріжка (0-based): смуги в одній доріжці ніколи не перетинаються */
  row: number;
  startIndex: number;
  endIndex: number;
  segment: SpanSegment;
}

export interface SpanLayout {
  slots: Map<string, SpanSlot>;
  /** Скільки доріжок вийшло — стільки рядів має зарезервувати рендер */
  rows: number;
}

function segmentOf(item: SpanInput): SpanSegment {
  if (item.clippedStart && item.clippedEnd) {
    return 'middle';
  }
  if (item.clippedStart) {
    return 'end';
  }
  if (item.clippedEnd) {
    return 'start';
  }
  return 'full';
}

/**
 * Смуги → доріжки. Довші й ранніші отримують верхні доріжки: так око читає
 * «широке — контекст, вузьке — деталь», і смуга тижня не стрибає між рядами
 * при появі одноденної події поруч.
 */
export function layoutSpans(items: readonly SpanInput[]): SpanLayout {
  const sorted = [...items].sort(
    (a, b) =>
      a.startIndex - b.startIndex ||
      b.endIndex - b.startIndex - (a.endIndex - a.startIndex) ||
      a.id.localeCompare(b.id),
  );

  const slots = new Map<string, SpanSlot>();
  /** Останній зайнятий день у кожній доріжці */
  const rowEnds: number[] = [];

  for (const item of sorted) {
    const free = rowEnds.findIndex((end) => end < item.startIndex);
    const row = free === -1 ? rowEnds.length : free;
    rowEnds[row] = item.endIndex;
    slots.set(item.id, {
      row,
      startIndex: item.startIndex,
      endIndex: item.endIndex,
      segment: segmentOf(item),
    });
  }

  return { slots, rows: rowEnds.length };
}

/**
 * Події → входи розкладки для конкретного вікна днів.
 *
 * All-day подія розкладається по датах у зоні ПОДІЇ (§6.2: день народження
 * 6-го числа лишається 6-м і в Києві, і в Нью-Йорку), тому курсор іде добами
 * саме її зони — а індекс у вікні шукається за ключем дня глядача. Це та сама
 * семантика, що була в `groupAllDay`; змінився лише результат — смуга замість
 * плитки на кожен день.
 */
export function allDaySpans(
  events: readonly CalendarEventResponse[],
  days: readonly TZDate[],
  timeZone: string,
): { inputs: SpanInput[]; byId: Map<string, CalendarEventResponse> } {
  const indexByKey = new Map(days.map((day, index) => [dayKey(day, timeZone), index]));
  const inputs: SpanInput[] = [];
  const byId = new Map<string, CalendarEventResponse>();

  for (const event of events) {
    if (!event.allDay) {
      continue;
    }
    const zone = displayZoneFor(event, timeZone);
    const end = new Date(event.occurrenceEnd).getTime();
    let cursor = new TZDate(new Date(event.occurrenceStart), zone);

    let startIndex = -1;
    let endIndex = -1;
    let clippedStart = false;
    let clippedEnd = false;

    while (cursor.getTime() < end) {
      const index = indexByKey.get(dayKey(cursor, timeZone));
      if (index === undefined) {
        // Доба поза вікном: до нього чи після — визначає те, чи ми вже
        // зустріли хоч один день вікна
        if (startIndex === -1) {
          clippedStart = true;
        } else {
          clippedEnd = true;
        }
      } else {
        if (startIndex === -1) {
          startIndex = index;
        }
        endIndex = index;
      }
      cursor = new TZDate(cursor.getTime() + 86_400_000, zone);
    }

    if (startIndex === -1) {
      // Подія не перетинає вікно взагалі
      continue;
    }
    const key = `${event.id}:${event.occurrenceStart}`;
    inputs.push({ id: key, startIndex, endIndex, clippedStart, clippedEnd });
    byId.set(key, event);
  }

  return { inputs, byId };
}
