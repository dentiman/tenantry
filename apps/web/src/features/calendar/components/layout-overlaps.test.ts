import { describe, expect, it } from 'vitest';
import { layoutOverlaps, slotStyle, type OverlapInput } from './layout-overlaps';

/** Хвилини від початку доби — так само, як їх бачить сітка */
const at = (id: string, from: number, to: number): OverlapInput => ({
  id,
  startMinutes: from,
  endMinutes: to,
});

const HOUR = 60;
const NINE = 9 * HOUR;

describe('layoutOverlaps', () => {
  it('порожній список дає порожню розкладку', () => {
    expect(layoutOverlaps([]).size).toBe(0);
  });

  it('події, що не перетинаються, займають повну ширину кожна', () => {
    const slots = layoutOverlaps([at('a', NINE, NINE + HOUR), at('b', NINE + 2 * HOUR, NINE + 3 * HOUR)]);
    expect(slots.get('a')).toEqual({ column: 0, columns: 1 });
    expect(slots.get('b')).toEqual({ column: 0, columns: 1 });
  });

  it('дві паралельні події діляться навпіл', () => {
    const slots = layoutOverlaps([at('a', NINE, NINE + HOUR), at('b', NINE + 30, NINE + 90)]);
    expect(slots.get('a')).toEqual({ column: 0, columns: 2 });
    expect(slots.get('b')).toEqual({ column: 1, columns: 2 });
  });

  /**
   * Головний випадок, який ламають рефакторингом: A і C не перетинаються між
   * собою, але обидві перетинають B — отже всі троє в ОДНОМУ кластері, і C має
   * право стати в колонку, що звільнилась після A.
   */
  it('ланцюжок через сусіда лишається одним кластером, а колонка перевикористовується', () => {
    const slots = layoutOverlaps([
      at('a', NINE, NINE + HOUR),
      at('b', NINE + 30, NINE + 90),
      at('c', NINE + 75, NINE + 120),
    ]);
    expect(slots.get('a')).toEqual({ column: 0, columns: 2 });
    expect(slots.get('b')).toEqual({ column: 1, columns: 2 });
    expect(slots.get('c')).toEqual({ column: 0, columns: 2 });
  });

  it('три одночасні події дають три колонки', () => {
    const slots = layoutOverlaps([
      at('a', NINE, NINE + HOUR),
      at('b', NINE, NINE + HOUR),
      at('c', NINE, NINE + HOUR),
    ]);
    expect(slots.get('a')?.columns).toBe(3);
    expect(slots.get('b')?.columns).toBe(3);
    expect(slots.get('c')?.columns).toBe(3);
    expect([slots.get('a')?.column, slots.get('b')?.column, slots.get('c')?.column].sort()).toEqual(
      [0, 1, 2],
    );
  });

  /**
   * Подія нульової тривалості (і будь-яка коротша за 15 хв) займає мінімальну
   * ВИЗУАЛЬНУ висоту — інакше в неї неможливо було б клікнути. Наслідок: вона
   * конфліктує з тим, що починається в межах цих 15 хв, навіть якщо за
   * даними перетину немає.
   */
  it('коротша за слот подія займає 15 хв і тому впливає на сусідів', () => {
    const slots = layoutOverlaps([at('a', NINE, NINE), at('b', NINE + 5, NINE + 30)]);
    expect(slots.get('a')).toEqual({ column: 0, columns: 2 });
    expect(slots.get('b')).toEqual({ column: 1, columns: 2 });
  });

  it('порядок у вхідному масиві не впливає на результат', () => {
    const items = [at('a', NINE, NINE + HOUR), at('b', NINE + 30, NINE + 90)];
    expect(layoutOverlaps([...items].reverse())).toEqual(layoutOverlaps(items));
  });
});

describe('slotStyle', () => {
  it('переводить хвилини у відсотки доби', () => {
    const item = at('a', NINE, NINE + HOUR);
    const style = slotStyle(item, { column: 0, columns: 2 }, 1440);
    expect(style.top).toBe('37.5%');
    expect(Number.parseFloat(style.height)).toBeCloseTo((60 / 1440) * 100, 6);
    expect(style.left).toBe('0%');
    // Хвостик 2px — щоб сусідні плитки не злипались у суцільну смугу
    expect(style.width).toBe('calc(50% - 2px)');
  });

  it('друга колонка зсувається на свою ширину', () => {
    const style = slotStyle(at('b', 0, 60), { column: 1, columns: 2 }, 1440);
    expect(style.left).toBe('50%');
  });

  /**
   * У добу переходу на зимовий час доба має 1500 хвилин, і саме від неї
   * рахуються відсотки — інакше вечірні події того дня поїхали б угору.
   */
  it('рахує від ФАКТИЧНОЇ довжини доби, а не від 1440', () => {
    const style = slotStyle(at('a', 750, 810), { column: 0, columns: 1 }, 1500);
    expect(style.top).toBe('50%');
  });
});
