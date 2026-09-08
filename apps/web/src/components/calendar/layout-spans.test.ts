import { TZDate } from '@date-fns/tz';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { describe, expect, it } from 'vitest';
import { daysOfRange, parseDayKey } from '../../lib/calendar-date';
import { allDaySpans, layoutSpans, type SpanInput } from './layout-spans';

const span = (id: string, startIndex: number, endIndex: number, clip?: Partial<SpanInput>): SpanInput => ({
  id,
  startIndex,
  endIndex,
  clippedStart: false,
  clippedEnd: false,
  ...clip,
});

describe('layoutSpans', () => {
  it('порожній вхід не дає доріжок', () => {
    expect(layoutSpans([])).toEqual({ slots: new Map(), rows: 0 });
  });

  it('смуги, що не перетинаються, живуть в ОДНІЙ доріжці', () => {
    const { slots, rows } = layoutSpans([span('a', 0, 1), span('b', 2, 3)]);
    expect(rows).toBe(1);
    expect(slots.get('a')?.row).toBe(0);
    expect(slots.get('b')?.row).toBe(0);
  });

  it('дотик днями — це перетин: 0–1 і 1–2 не влазять в одну доріжку', () => {
    const { slots, rows } = layoutSpans([span('a', 0, 1), span('b', 1, 2)]);
    expect(rows).toBe(2);
    expect(slots.get('a')?.row).toBe(0);
    expect(slots.get('b')?.row).toBe(1);
  });

  it('довша смуга бере верхню доріжку', () => {
    const { slots } = layoutSpans([span('short', 0, 0), span('long', 0, 5)]);
    expect(slots.get('long')?.row).toBe(0);
    expect(slots.get('short')?.row).toBe(1);
  });

  it('доріжка перевикористовується, коли смуга закінчилась', () => {
    const { slots, rows } = layoutSpans([span('a', 0, 2), span('b', 1, 3), span('c', 4, 5)]);
    expect(rows).toBe(2);
    expect(slots.get('c')?.row).toBe(0);
  });

  it('сегмент читається з обрізаності по краях вікна', () => {
    const { slots } = layoutSpans([
      span('full', 1, 2),
      span('start', 3, 6, { clippedEnd: true }),
      span('end', 0, 1, { clippedStart: true }),
      span('middle', 0, 6, { clippedStart: true, clippedEnd: true }),
    ]);
    expect(slots.get('full')?.segment).toBe('full');
    expect(slots.get('start')?.segment).toBe('start');
    expect(slots.get('end')?.segment).toBe('end');
    expect(slots.get('middle')?.segment).toBe('middle');
  });

  it('порядок у вхідному масиві не впливає на результат', () => {
    const items = [span('a', 0, 2), span('b', 1, 3), span('c', 4, 5)];
    expect(layoutSpans([...items].reverse())).toEqual(layoutSpans(items));
  });
});

// ---------------------------------------------------------------- allDaySpans

const KYIV = 'Europe/Kyiv';

/** Вікно тижня 7–13 вересня 2026 у зоні глядача */
const week = (timeZone: string): TZDate[] => {
  const from = parseDayKey('2026-09-07', timeZone);
  const to = parseDayKey('2026-09-14', timeZone);
  return daysOfRange(from, to, timeZone);
};

const allDayEvent = (
  id: string,
  startsAt: string,
  endsAt: string,
  timeZone = KYIV,
): CalendarEventResponse =>
  ({
    id,
    title: id,
    allDay: true,
    timeZone,
    startsAt,
    endsAt,
    occurrenceStart: startsAt,
    occurrenceEnd: endsAt,
  }) as unknown as CalendarEventResponse;

describe('allDaySpans', () => {
  it('події з часом смугами не стають', () => {
    const timed = { ...allDayEvent('t', '2026-09-08T09:00:00.000Z', '2026-09-08T10:00:00.000Z'), allDay: false };
    const { inputs } = allDaySpans([timed], week(KYIV), KYIV);
    expect(inputs).toEqual([]);
  });

  /**
   * All-day 10–12 вересня в Києві — це інстанти [09.09 21:00Z, 12.09 21:00Z):
   * межа кінця ЕКСКЛЮЗИВНА, тож смуга займає три дні (індекси 3..5 у вікні,
   * яке починається з 7 вересня), а не чотири.
   */
  it('триденна подія дає ОДНУ смугу на три дні', () => {
    const event = allDayEvent('vacation', '2026-09-09T21:00:00.000Z', '2026-09-12T21:00:00.000Z');
    const { inputs } = allDaySpans([event], week(KYIV), KYIV);
    expect(inputs).toEqual([
      { id: 'vacation:2026-09-09T21:00:00.000Z', startIndex: 3, endIndex: 5, clippedStart: false, clippedEnd: false },
    ]);
  });

  it('одноденна подія — смуга на один день', () => {
    const event = allDayEvent('birthday', '2026-09-07T21:00:00.000Z', '2026-09-08T21:00:00.000Z');
    const [input] = allDaySpans([event], week(KYIV), KYIV).inputs;
    expect(input?.startIndex).toBe(1);
    expect(input?.endIndex).toBe(1);
  });

  it('подія, що почалась до вікна, позначається обрізаною ліворуч', () => {
    const event = allDayEvent('long', '2026-09-04T21:00:00.000Z', '2026-09-09T21:00:00.000Z');
    const [input] = allDaySpans([event], week(KYIV), KYIV).inputs;
    expect(input).toMatchObject({ startIndex: 0, endIndex: 2, clippedStart: true, clippedEnd: false });
  });

  it('подія, що триває після вікна, позначається обрізаною праворуч', () => {
    const event = allDayEvent('long', '2026-09-11T21:00:00.000Z', '2026-09-20T21:00:00.000Z');
    const [input] = allDaySpans([event], week(KYIV), KYIV).inputs;
    expect(input).toMatchObject({ startIndex: 5, endIndex: 6, clippedStart: false, clippedEnd: true });
  });

  it('подія, що накриває все вікно, обрізана з обох боків', () => {
    const event = allDayEvent('quarter', '2026-08-31T21:00:00.000Z', '2026-09-30T21:00:00.000Z');
    const [input] = allDaySpans([event], week(KYIV), KYIV).inputs;
    expect(input).toMatchObject({ startIndex: 0, endIndex: 6, clippedStart: true, clippedEnd: true });
  });

  it('подія повністю поза вікном не потрапляє в розкладку', () => {
    const event = allDayEvent('other', '2026-10-01T21:00:00.000Z', '2026-10-02T21:00:00.000Z');
    expect(allDaySpans([event], week(KYIV), KYIV).inputs).toEqual([]);
  });

  it('ключ смуги несе входження — серії CAL-4 не злипнуться', () => {
    const event = allDayEvent('e1', '2026-09-08T21:00:00.000Z', '2026-09-09T21:00:00.000Z');
    const { inputs, byId } = allDaySpans([event], week(KYIV), KYIV);
    expect(inputs[0]?.id).toBe('e1:2026-09-08T21:00:00.000Z');
    expect(byId.get('e1:2026-09-08T21:00:00.000Z')).toBe(event);
  });
});
