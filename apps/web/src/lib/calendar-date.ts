import { TZDate } from '@date-fns/tz';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import i18n from 'i18next';

/**
 * Арифметика дат календаря (docs/calendar.md §11.6).
 *
 * `date-fns` + `@date-fns/tz` тут, а не голий `Intl`: сітці потрібні «початок
 * тижня», «+7 днів», «дні місяця з добивкою» — у зоні ГЛЯДАЧА. `TZDate` робить
 * локальні геттери зонними, тож усі функції date-fns починають рахувати в
 * потрібній зоні без власних велосипедів.
 *
 * Форматування лишається на `Intl` (`formatInZone` нижче): так локалізація дат
 * безкоштовна для кожної нової мови — рівно те, що вже робить `libs/ui/lib/format`.
 */

export type CalendarView = 'day' | 'week' | 'month' | 'agenda';

export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month', 'agenda'];

export function isCalendarView(value: string): value is CalendarView {
  return CALENDAR_VIEWS.some((view) => view === value);
}

/** Крок сітки — 15 хв (рішення §17); від нього залежить і прилипання, і DnD у CAL-2 */
export const SLOT_MINUTES = 15;
export const MINUTES_PER_DAY = 1440;

/** `yyyy-MM-dd` у зоні глядача — ключ дня в сітці й значення `?date=` в URL */
export function dayKey(instant: Date | string, timeZone: string): string {
  const zoned = new TZDate(new Date(instant), timeZone);
  const month = String(zoned.getMonth() + 1).padStart(2, '0');
  const day = String(zoned.getDate()).padStart(2, '0');
  return `${String(zoned.getFullYear())}-${month}-${day}`;
}

/** `yyyy-MM-dd` → опівніч цієї доби в зоні глядача */
export function parseDayKey(key: string, timeZone: string): TZDate {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, timeZone);
}

/**
 * Той самий ключ, але **звичайним локальним `Date`** — для `react-day-picker`.
 *
 * Спіймано в браузері: у міні-місяці підсвічувався сусідній день. Причина —
 * `TZDate` несе ІНСТАНТ (опівніч у зоні глядача), а date-picker будує свої дні
 * в зоні ПРИСТРОЮ і порівнює через `isSameDay`. Щойно зона глядача розходиться
 * із зоною пристрою (у нас: UTC проти +03:00), «та сама» доба стає різною.
 * Пікер живе в локальному часі — значить і значення йому треба давати локальне.
 */
export function parseDayKeyAsLocalDate(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * Дата → ISO-інстант із `Z`, тобто **wire-формат контрактів**.
 *
 * Не декоративна обгортка: `TZDate.prototype.toISOString()` віддає час зі
 * ЗСУВОМ (`2026-09-07T00:00:00.000+03:00`), а `z.iso.datetime()` у контрактах
 * приймає лише `Z` — і кожен вікновий запит повертався 400-кою (спіймано
 * живим прогоном у браузері). `new Date(ms)` знімає зонну обгортку, лишаючи
 * той самий момент.
 */
export function toInstantIso(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

export function todayKey(timeZone: string): string {
  return dayKey(new Date(), timeZone);
}

/**
 * Вікно перегляду. Місяць бере ПОВНІ тижні (сітка 6×7 малює й добивку сусідніх
 * місяців — інакше в клітинках «хвостів» події просто не показувались би).
 */
export function viewRange(
  view: CalendarView,
  anchorKey: string,
  timeZone: string,
  weekStartsOn: number,
): { from: Date; to: Date } {
  const anchor = parseDayKey(anchorKey, timeZone);
  const start = (() => {
    switch (view) {
      case 'day':
        return anchor;
      case 'week':
        return startOfWeek(anchor, { weekStartsOn: asWeekStart(weekStartsOn) });
      case 'month':
        return startOfWeek(startOfMonth(anchor), { weekStartsOn: asWeekStart(weekStartsOn) });
      case 'agenda':
        return anchor;
    }
  })();
  const days = (() => {
    switch (view) {
      case 'day':
        return 1;
      case 'week':
        return 7;
      case 'month':
        return monthGridDays(anchor, weekStartsOn);
      case 'agenda':
        // Agenda ходить курсорним ендпоінтом, вікно їй не потрібне — але межа
        // потрібна для підпису періоду
        return 30;
    }
  })();
  return { from: start, to: addDays(start, days) };
}

/** Скільки днів у сітці місяця: 35 або 42 — рахуємо, а не хардкодимо 6 тижнів */
function monthGridDays(anchor: Date, weekStartsOn: number): number {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: asWeekStart(weekStartsOn) });
  const gridEnd = addWeeks(startOfWeek(endOfMonth(anchor), { weekStartsOn: asWeekStart(weekStartsOn) }), 1);
  return differenceInCalendarDays(gridEnd, gridStart);
}

/** Перелік днів вікна (для колонок тижня і клітинок місяця) */
export function daysOfRange(from: Date, to: Date, timeZone: string): TZDate[] {
  const days: TZDate[] = [];
  let cursor = new TZDate(from, timeZone);
  while (cursor.getTime() < to.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Крок навігації «‹ ›» — той самий, що й крок перегляду */
export function shiftAnchor(
  view: CalendarView,
  anchorKey: string,
  timeZone: string,
  direction: 1 | -1,
): string {
  const anchor = parseDayKey(anchorKey, timeZone);
  switch (view) {
    case 'day':
      return dayKey(addDays(anchor, direction), timeZone);
    case 'week':
      return dayKey(addWeeks(anchor, direction), timeZone);
    case 'month':
      return dayKey(addMonths(anchor, direction), timeZone);
    case 'agenda':
      return dayKey(addDays(anchor, 30 * direction), timeZone);
  }
}

/**
 * Хвилини від початку доби до інстанта в зоні глядача. Саме так, а не через
 * різницю в мілісекундах: доба переходу на зимовий час має 25 годин, і
 * «години × 60» дало б зсув усіх подій того дня.
 */
export function minutesFromDayStart(instant: Date | string, timeZone: string): number {
  const zoned = new TZDate(new Date(instant), timeZone);
  const start = startOfDay(zoned);
  return (zoned.getTime() - start.getTime()) / 60_000;
}

/** Скільки хвилин у добі (23/24/25 годин у дні переходів) */
export function minutesInDay(day: Date, timeZone: string): number {
  const start = startOfDay(new TZDate(day, timeZone));
  return (addDays(start, 1).getTime() - start.getTime()) / 60_000;
}

/**
 * Звуження до літерального юніону, який чекають і `date-fns`, і
 * `react-day-picker`. У контракті поле — просто `number` (формат
 * `Date.getDay()`), тож звужувати мусить споживач, а не схема: інакше кожен
 * новий календарний UI приносив би власний каст на місці.
 */
export function asWeekStart(value: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return (value >= 0 && value <= 6 ? value : 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

// ---------------------------------------------------------------- формати

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(i18n.language, { ...options, timeZone });
}

export function formatTime(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { hour: 'numeric', minute: '2-digit' }).format(new Date(instant));
}

export function formatDayLabel(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { weekday: 'short', day: 'numeric' }).format(new Date(instant));
}

export function formatWeekday(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { weekday: 'short' }).format(new Date(instant));
}

export function formatFullDate(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { dateStyle: 'full' }).format(new Date(instant));
}

export function formatMonthYear(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { month: 'long', year: 'numeric' }).format(new Date(instant));
}

export function formatDateTime(instant: Date | string, timeZone: string): string {
  return formatter(timeZone, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant));
}

/**
 * Підпис періоду в тулбарі.
 *
 * Місяць підписується **анкором**, а не краями сітки: сітка місяця показує повні
 * тижні, тож її перший день часто належить попередньому місяцю, а останній —
 * наступному. Спіймано в браузері: над вереснем стояв підпис «October 2026»
 * (сітка тяглася до 4 жовтня).
 *
 * Agenda сюди не потрапляє взагалі — у нескінченного фіда діапазону немає, і
 * показувати вигадані 30 днів означало б брехати; підпис для неї дає сторінка
 * через i18n.
 */
export function formatRangeLabel(
  view: Exclude<CalendarView, 'agenda'>,
  anchorKey: string,
  from: Date,
  to: Date,
  timeZone: string,
): string {
  if (view === 'day') {
    return formatFullDate(from, timeZone);
  }
  if (view === 'month') {
    return formatMonthYear(parseDayKey(anchorKey, timeZone), timeZone);
  }
  // Тиждень: якщо він перетинає межу місяців, у підписі обидві назви — інакше
  // «September 2026» над сіткою, де половина днів жовтневі, теж бреше
  const lastDay = addDays(new TZDate(to, timeZone), -1);
  const startLabel = formatMonthYear(from, timeZone);
  const endLabel = formatMonthYear(lastDay, timeZone);
  return startLabel === endLabel ? startLabel : `${startLabel} — ${endLabel}`;
}

/**
 * All-day рендериться в зоні ПОДІЇ, а не глядача (§6.2): день народження
 * 6 вересня лишається 6 вересня і в Києві, і в Нью-Йорку. Для подій із часом
 * зона — глядача.
 */
export function displayZoneFor(
  event: { allDay: boolean; timeZone: string },
  viewerZone: string,
): string {
  return event.allDay ? event.timeZone : viewerZone;
}

/** Зона пристрою — останній фолбек, коли ні в юзера, ні в компанії її немає */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
