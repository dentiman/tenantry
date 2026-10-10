import { createHash } from 'node:crypto';

/**
 * Детермінований UUID (v5-подібний, SHA-1 від ключа). Усі демо-сутності мають стабільні id:
 * повторний запуск оновлює ті самі рядки, а посилання на сторінки демо (напр. картка
 * кастомера) переживають `--reset`.
 */
export function uid(...parts: (string | number)[]): string {
  const hash = createHash('sha1').update(parts.join('|')).digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/** mulberry32: маленький сідований ГПВЧ — `Math.random` у сіді заборонений (дані мусять збігатися між запусками) */
export function createRng(seed: string): Rng {
  let state = createHash('sha1').update(seed).digest().readUInt32LE(0);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick() from an empty list');
      return item;
    },
    chance: (p) => next() < p,
  };
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

interface LocalDate {
  year: number;
  month: number; // 1–12
  day: number;
}

function localParts(instant: Date, timeZone: string): LocalDate & { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Зсув зони від UTC в мс на заданий момент (з урахуванням DST) */
function offsetMs(instant: Date, timeZone: string): number {
  const l = localParts(instant, timeZone);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  return asUtc - Math.floor(instant.getTime() / MINUTE) * MINUTE;
}

/** Миттєвість, якій у зоні відповідає настінний час `y-m-d hh:mm` */
function fromWallClock(date: LocalDate, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hh, mm);
  // Два проходи: перший дає наближення зсуву, другий виправляє перетин межі DST
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/**
 * Робочий день зі зсувом `n` від сьогодні в зоні `timeZone` (n=0 — сьогодні, а на вихідних —
 * найближчий понеділок; n<0 — назад, n>0 — вперед, субота/неділя пропускаються).
 * Календар демо мусить виглядати як у справжньої команди: ніяких зустрічей у неділю.
 */
export function workday(now: Date, n: number, timeZone: string): LocalDate {
  const today = localParts(now, timeZone);
  const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const isWeekend = (d: Date): boolean => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  while (isWeekend(cursor)) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (!isWeekend(cursor)) left -= 1;
  }
  return { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
}

/** `workday(n)` о `HH:mm` за місцевим часом зони — момент для `starts_at` */
export function atWorkday(now: Date, n: number, hhmm: string, timeZone: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  return fromWallClock(workday(now, n, timeZone), hh ?? 0, mm ?? 0, timeZone);
}

/** Початок місцевої доби робочого дня `n` (для подій на весь день, які зберігаються як UTC-дата) */
export function allDayStart(now: Date, n: number, timeZone: string): Date {
  return fromWallClock(workday(now, n, timeZone), 0, 0, timeZone);
}
