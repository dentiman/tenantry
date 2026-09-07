/**
 * Час, зони і all-day (docs/calendar.md §6) — чисті функції без залежностей.
 *
 * Дата-бібліотеки тут свідомо НЕМАЄ: бекенду потрібні рівно дві операції —
 * «межі доби в зоні X» і «зсув на N хвилин», і обидві робить `Intl`, чия база
 * зон приїжджає з платформою. `date-fns` + `@date-fns/tz` (рішення 2026-09-06)
 * додається ФРОНТУ, де сітка тижня справді вимагає арифметики дат; тягнути
 * зовнішній пакет у webpack-збірку api і воркера заради 30 рядків — гірший
 * обмін, ніж тримати ці 30 рядків.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(date: Date, timeZone: string): ZonedParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = formatted.find((item) => item.type === type)?.value ?? '0';
    // 'hour' у форматі h23 може прийти як '24' для півночі в деяких рантаймах
    return Number.parseInt(part, 10) % (type === 'hour' ? 24 : 1_000_000);
  };

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Зсув зони В ЦЕЙ МОМЕНТ (мс). Саме в момент, а не «зсув зони»: DST */
function offsetMsAt(date: Date, timeZone: string): number {
  const parts = partsIn(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Мілісекунди в asUtc губляться (Intl їх не віддає) — вирівнюємо, щоб зсув
  // не «плавав» на дрібні частки
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Локальний час у зоні → UTC-інстант. Двокрокове наближення обовʼязкове: зсув
 * залежить від моменту, який ми ще шукаємо, тому перше припущення може впасти
 * по інший бік переходу на літній час.
 *
 * Неіснуючий локальний час (ніч переходу вперед) і подвійний (перехід назад)
 * розвʼязуються в бік однієї з гілок — це нормально: календарі так і роблять,
 * а нашою межею є ДОБА, у якій такої діри не буває.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = offsetMsAt(new Date(guess), timeZone);
  const firstTry = guess - firstOffset;
  const secondOffset = offsetMsAt(new Date(firstTry), timeZone);
  return new Date(secondOffset === firstOffset ? firstTry : guess - secondOffset);
}

/** Опівніч доби, В ЯКУ потрапляє інстант, у зоні події */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  const parts = partsIn(date, timeZone);
  return zonedTimeToUtc(timeZone, parts.year, parts.month, parts.day);
}

/**
 * Нормалізація all-day: межі стають опівніччю в зоні ПОДІЇ, кінець лишається
 * ЕКСКЛЮЗИВНИМ. Одноденна подія 6 вересня — це [06.09 00:00, 07.09 00:00).
 *
 * Клієнт може прислати будь-який час (він для all-day не значущий) і навіть
 * кінець, що дорівнює початку — «на один день» тут природний дефолт, а не
 * помилка вводу.
 */
export function normalizeAllDayRange(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const start = startOfDayInZone(startsAt, timeZone);
  const rawEnd = startOfDayInZone(endsAt, timeZone);
  if (rawEnd.getTime() > start.getTime()) {
    return { startsAt: start, endsAt: rawEnd };
  }
  // Наступна опівніч рахується через полудень: +24 год у ніч переходу на
  // літній час дали б 01:00, а не 00:00 наступної доби
  const noonNext = new Date(start.getTime() + DAY_MS + 12 * 60 * MINUTE_MS);
  const parts = partsIn(noonNext, timeZone);
  return {
    startsAt: start,
    endsAt: zonedTimeToUtc(timeZone, parts.year, parts.month, parts.day),
  };
}

/** Момент спрацювання нагадування: N хвилин ДО початку події */
export function reminderFireAt(startsAt: Date, minutesBefore: number): Date {
  return new Date(startsAt.getTime() - minutesBefore * MINUTE_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}
