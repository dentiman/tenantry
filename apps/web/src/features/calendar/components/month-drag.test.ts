import { describe, expect, it } from 'vitest';
import { monthDayShift, monthSlotCount, monthSnap } from './month-drag';

const CELL = 140;
const ROW = 120;

describe('monthDayShift', () => {
  it('рух у межах половини клітинки нічого не зсуває', () => {
    expect(monthDayShift(60, 40, CELL, ROW)).toBe(0);
  });

  it('колонка праворуч — це +1 день', () => {
    expect(monthDayShift(CELL, 0, CELL, ROW)).toBe(1);
    expect(monthDayShift(-CELL * 2, 0, CELL, ROW)).toBe(-2);
  });

  it('ряд донизу — це РІВНО тиждень', () => {
    expect(monthDayShift(0, ROW, CELL, ROW)).toBe(7);
    expect(monthDayShift(0, -ROW, CELL, ROW)).toBe(-7);
  });

  it('діагональ складається з тижнів і днів', () => {
    // Два ряди вниз і одна колонка праворуч: 3-тє → 18-те
    expect(monthDayShift(CELL, ROW * 2, CELL, ROW)).toBe(15);
    // Ряд вниз, дві колонки ліворуч
    expect(monthDayShift(-CELL * 2, ROW, CELL, ROW)).toBe(5);
  });

  it('нульові розміри не ділять на нуль', () => {
    expect(monthDayShift(500, 500, 0, 0)).toBe(0);
  });
});

describe('monthSnap', () => {
  it('час доби НЕ чіпається — у місяці координати години немає', () => {
    expect(monthSnap(CELL, ROW)(CELL, ROW)).toEqual({ minutes: 0, dayShift: 8 });
  });
});

describe('monthSlotCount', () => {
  const HEAD = 28;
  const SPAN = 22;

  it('рахує від вільної висоти ряду', () => {
    // 160 - 28 = 132 вільних, по 22px на плитку → 6 (стеля)
    expect(monthSlotCount(160, HEAD, 0, SPAN)).toBe(6);
    // 100 - 28 = 72 → 3
    expect(monthSlotCount(100, HEAD, 0, SPAN)).toBe(3);
  });

  it('доріжки смуг з’їдають слоти', () => {
    expect(monthSlotCount(100, HEAD, 2, SPAN)).toBe(1);
  });

  it('ніколи не менше одного і не більше шести', () => {
    expect(monthSlotCount(30, HEAD, 0, SPAN)).toBe(1);
    expect(monthSlotCount(1000, HEAD, 0, SPAN)).toBe(6);
  });
});
