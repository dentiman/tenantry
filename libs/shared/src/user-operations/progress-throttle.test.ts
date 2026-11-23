import { describe, expect, it } from 'vitest';
import { shouldWriteProgress } from './progress-throttle';

const options = { minIntervalMs: 1000, minStep: 500 };

describe('shouldWriteProgress', () => {
  it('writes the first value and the final one regardless of throttling', () => {
    expect(shouldWriteProgress(null, 0, 1, 1000, options)).toBe(true);
    expect(shouldWriteProgress({ at: 0, current: 990 }, 10, 1000, 1000, options)).toBe(true);
  });

  it('skips small, frequent updates', () => {
    expect(shouldWriteProgress({ at: 0, current: 10 }, 200, 50, 10_000, options)).toBe(false);
  });

  it('writes after the interval or after enough units', () => {
    expect(shouldWriteProgress({ at: 0, current: 10 }, 1000, 11, 10_000, options)).toBe(true);
    expect(shouldWriteProgress({ at: 0, current: 10 }, 50, 510, 10_000, options)).toBe(true);
  });
});
