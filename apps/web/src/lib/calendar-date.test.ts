import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dayKey,
  daysFromToday,
  defaultCreateStart,
  isWeekend,
  minutesFromDayStart,
  minutesInDay,
  toInstantIso,
  viewRange,
} from './calendar-date';

const KYIV = 'Europe/Kyiv';

afterEach(() => {
  vi.useRealTimers();
});

describe('dayKey', () => {
  it('день рахується в зоні ГЛЯДАЧА, а не пристрою', () => {
    // 22:00Z 13 вересня — це вже 14-те в Києві (UTC+3)
    expect(dayKey('2026-09-13T22:00:00.000Z', 'UTC')).toBe('2026-09-13');
    expect(dayKey('2026-09-13T22:00:00.000Z', KYIV)).toBe('2026-09-14');
  });
});

describe('toInstantIso', () => {
  /**
   * `TZDate.prototype.toISOString()` віддає час зі ЗСУВОМ, а контракти
   * приймають лише `Z` — саме через це кожен вікновий запит колись повертався
   * 400-кою (§18). Тест закріплює формат дроту.
   */
  it('завжди дає ISO з Z', () => {
    const iso = toInstantIso(new Date('2026-09-08T09:00:00.000Z'));
    expect(iso).toBe('2026-09-08T09:00:00.000Z');
    expect(iso.endsWith('Z')).toBe(true);
  });
});

describe('isWeekend', () => {
  it('субота й неділя — вихідні', () => {
    expect(isWeekend(new Date('2026-09-12T12:00:00.000Z'), 'UTC')).toBe(true);
    expect(isWeekend(new Date('2026-09-13T12:00:00.000Z'), 'UTC')).toBe(true);
    expect(isWeekend(new Date('2026-09-14T12:00:00.000Z'), 'UTC')).toBe(false);
  });

  it('визначається в зоні глядача', () => {
    // 22:00Z неділі — у Києві вже понеділок, тобто робочий день
    const instant = new Date('2026-09-13T22:00:00.000Z');
    expect(isWeekend(instant, 'UTC')).toBe(true);
    expect(isWeekend(instant, KYIV)).toBe(false);
  });
});

describe('minutesInDay', () => {
  it('звичайна доба — 1440 хвилин', () => {
    expect(minutesInDay(new Date('2026-09-08T00:00:00.000Z'), KYIV)).toBe(1440);
  });

  /** 25 жовтня 2026 Київ переходить на зимовий час: доба на годину довша */
  it('доба переходу на зимовий час має 25 годин', () => {
    expect(minutesInDay(new Date('2026-10-25T12:00:00.000Z'), KYIV)).toBe(1500);
  });

  /** 29 березня 2026 — навпаки, доба коротша */
  it('доба переходу на літній час має 23 години', () => {
    expect(minutesInDay(new Date('2026-03-29T12:00:00.000Z'), KYIV)).toBe(1380);
  });
});

describe('minutesFromDayStart', () => {
  it('рахує від початку доби в зоні глядача', () => {
    // 09:00 у Києві = 06:00Z у вересні (UTC+3)
    expect(minutesFromDayStart('2026-09-08T06:00:00.000Z', KYIV)).toBe(540);
  });

  /**
   * Найважливіший випадок — і той, на якому я сам спершу помилився в
   * очікуванні. 25 жовтня 2026 Київ переводить годинники назад, тож доба має
   * 25 годин, і година між 03:00 і 04:00 прожита ДВІЧІ. Місцевий 10:00 стоїть
   * тому не на 600-й хвилині доби, а на 660-й: функція рахує ФАКТИЧНУ
   * інстантну різницю від початку доби, а не «години × 60» місцевого часу.
   *
   * Саме це число потрібне сітці: `slotStyle` розкладає плитки у відсотках від
   * `minutesInDay` (того дня — 1500), і «10:00» мусить впасти на 44% висоти
   * колонки, а не на 41.7%.
   */
  it('у добу переходу рахує фактичні хвилини, а не години × 60', () => {
    expect(minutesFromDayStart('2026-10-25T08:00:00.000Z', KYIV)).toBe(660);
    // Той самий місцевий час у звичайну добу — рівно 600
    expect(minutesFromDayStart('2026-09-08T07:00:00.000Z', KYIV)).toBe(600);
  });
});

describe('viewRange', () => {
  it('тиждень із понеділка бере 7 днів', () => {
    const { from, to } = viewRange('week', '2026-09-08', KYIV, 1);
    expect(dayKey(from, KYIV)).toBe('2026-09-07');
    // Межа ексклюзивна — наступний понеділок
    expect(dayKey(to, KYIV)).toBe('2026-09-14');
  });

  it('перший день тижня змінює межі', () => {
    const { from } = viewRange('week', '2026-09-08', KYIV, 0);
    expect(dayKey(from, KYIV)).toBe('2026-09-06');
  });

  it('день — це одна доба', () => {
    const { from, to } = viewRange('day', '2026-09-08', KYIV, 1);
    expect(dayKey(from, KYIV)).toBe('2026-09-08');
    expect(dayKey(to, KYIV)).toBe('2026-09-09');
  });

  it('місяць бере ПОВНІ тижні — інакше події в клітинках добивки не показались би', () => {
    const { from, to } = viewRange('month', '2026-09-15', KYIV, 1);
    expect(dayKey(from, KYIV)).toBe('2026-08-31');
    expect(dayKey(to, KYIV)).toBe('2026-10-05');
  });
});

describe('daysFromToday', () => {
  it('рахує КАЛЕНДАРНІ доби, а не різницю в годинах', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T20:30:00.000Z'));
    expect(daysFromToday('2026-09-08T23:59:00.000Z', 'UTC')).toBe(0);
    // Різниця з «зараз» — півтори години, але це вже інша доба
    expect(daysFromToday('2026-09-09T00:30:00.000Z', 'UTC')).toBe(1);
    expect(daysFromToday('2026-09-07T23:00:00.000Z', 'UTC')).toBe(-1);
  });
});

describe('defaultCreateStart', () => {
  it('на сьогодні — найближчий слот УГОРУ від зараз', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:07:00.000Z'));
    const start = defaultCreateStart('2026-09-08', 'UTC', '09:00');
    expect(toInstantIso(start)).toBe('2026-09-08T10:15:00.000Z');
  });

  it('точно на межі слота нічого не додає', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:15:00.000Z'));
    expect(toInstantIso(defaultCreateStart('2026-09-08', 'UTC', '09:00'))).toBe(
      '2026-09-08T10:15:00.000Z',
    );
  });

  it('на іншу добу — початок робочого дня з налаштувань', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:07:00.000Z'));
    // 09:00 у Києві у вересні = 06:00Z
    expect(toInstantIso(defaultCreateStart('2026-09-10', KYIV, '09:00'))).toBe(
      '2026-09-10T06:00:00.000Z',
    );
  });

  it('«сьогодні» визначається в зоні глядача', () => {
    vi.useFakeTimers();
    // 22:30Z — у Києві вже наступна доба, тож для київського «сьогодні»
    // (14 вересня) спрацьовує гілка «зараз», а не робочий день
    vi.setSystemTime(new Date('2026-09-13T22:30:00.000Z'));
    expect(toInstantIso(defaultCreateStart('2026-09-14', KYIV, '09:00'))).toBe(
      '2026-09-13T22:30:00.000Z',
    );
  });
});
