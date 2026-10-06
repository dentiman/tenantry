import { describe, expect, it } from 'vitest';
import { draftRange, minutesAtOffset } from './use-range-draft';

/** Звичайна доба, намальована як 1440px — тобто 1px = 1 хвилина */
const DAY = 1440;

describe('minutesAtOffset', () => {
  it('нульова висота колонки не ділить на нуль', () => {
    expect(minutesAtOffset(300, 0, DAY)).toBe(0);
  });

  it('верх колонки — початок доби, низ — її кінець', () => {
    expect(minutesAtOffset(0, DAY, DAY)).toBe(0);
    expect(minutesAtOffset(DAY, DAY, DAY)).toBe(DAY);
  });

  it('прилипає до кроку 15 хвилин', () => {
    expect(minutesAtOffset(7, DAY, DAY)).toBe(0);
    expect(minutesAtOffset(8, DAY, DAY)).toBe(15);
    expect(minutesAtOffset(614, DAY, DAY)).toBe(615);
  });

  it('обрізає вихід за межі колонки', () => {
    expect(minutesAtOffset(-50, DAY, DAY)).toBe(0);
    expect(minutesAtOffset(DAY + 200, DAY, DAY)).toBe(DAY);
  });

  /**
   * Хвилина рахується від ПОВНОЇ висоти колонки, а не від висоти години: у добу
   * переходу на зимовий час у сітці 1500 хвилин на ті самі 24 ряди, і через
   * висоту години чернетка поїхала б відносно вже намальованих подій.
   */
  it('масштабується довжиною доби, а не годинами', () => {
    // Половина колонки в 25-годинній добі — це 12:30, а не 12:00
    expect(minutesAtOffset(500, 1000, 1500)).toBe(750);
  });
});

describe('draftRange', () => {
  it('тягнення вниз дає інтервал як є', () => {
    expect(draftRange(600, 660, DAY)).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it('тягнення ВГОРУ міняє межі місцями (людина часто починає з кінця)', () => {
    expect(draftRange(660, 600, DAY)).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it('коротший за слот інтервал розтягується вниз', () => {
    expect(draftRange(600, 605, DAY)).toEqual({ startMinutes: 600, endMinutes: 615 });
  });

  it('клік без руху теж дає подію на один слот', () => {
    expect(draftRange(600, 600, DAY)).toEqual({ startMinutes: 600, endMinutes: 615 });
  });

  it('на самому дні доби розтягується ВГОРУ — за межу дня подія не виходить', () => {
    expect(draftRange(DAY, DAY, DAY)).toEqual({ startMinutes: DAY - 15, endMinutes: DAY });
  });

  it('у добу переходу межею є фактична довжина доби', () => {
    expect(draftRange(1500, 1500, 1500)).toEqual({ startMinutes: 1485, endMinutes: 1500 });
  });
});
