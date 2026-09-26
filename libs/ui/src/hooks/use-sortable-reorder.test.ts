import { describe, expect, it } from 'vitest';
import { autoScrollStep, moveBefore, resolveReorderTarget } from './use-sortable-reorder';

// Три сусіди з різною шириною (як заголовки колонок): середини 20, 90, 200
const others = [
  { id: 'a', mid: 20 },
  { id: 'b', mid: 90 },
  { id: 'c', mid: 200 },
];

describe('resolveReorderTarget', () => {
  it('ціль — перший сусід, чию середину центр ще не перейшов', () => {
    expect(resolveReorderTarget(others, 10, 0)).toBe('a');
    expect(resolveReorderTarget(others, 21, 0)).toBe('b');
    expect(resolveReorderTarget(others, 150, 0)).toBe('c');
  });

  it('за останньою серединою — у кінець (null)', () => {
    expect(resolveReorderTarget(others, 250, 0)).toBeNull();
  });

  it('симетрично: та сама межа в обидва боки (знімок, а не живий DOM)', () => {
    expect(resolveReorderTarget(others, 89, 0)).toBe('b');
    expect(resolveReorderTarget(others, 91, 0)).toBe('c');
  });

  it('перед закріпленими не вставити', () => {
    expect(resolveReorderTarget(others, 0, 1)).toBe('b');
    expect(resolveReorderTarget(others, 0, 3)).toBeNull();
  });
});

describe('moveBefore', () => {
  it('ставить перед сусідом у будь-який бік', () => {
    expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
  });

  it('null або невідомий сусід — у кінець', () => {
    expect(moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(moveBefore(['a', 'b'], 'a', 'ghost')).toEqual(['b', 'a']);
  });
});

describe('autoScrollStep', () => {
  it('поза зонами біля країв — 0', () => {
    expect(autoScrollStep(500, 0, 1000)).toBe(0);
  });

  it('біля початку — назад, біля кінця — вперед, швидше ближче до краю', () => {
    expect(autoScrollStep(30, 0, 1000)).toBeLessThan(0);
    expect(autoScrollStep(990, 0, 1000)).toBeGreaterThan(autoScrollStep(970, 0, 1000));
  });

  it('за краєм — стеля, а не прискорення без меж', () => {
    expect(autoScrollStep(5000, 0, 1000)).toBe(autoScrollStep(1000, 0, 1000));
  });
});
