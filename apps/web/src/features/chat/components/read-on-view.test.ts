import { describe, expect, it } from 'vitest';
import { shouldReportRead } from './read-on-view';

/**
 * «Прочитано» — це «дивилась людина» (design.md D6, фаза 0.2b): таблиця істинності правила.
 * Кожен вхід по черзі — той єдиний, що забороняє звіт.
 */
describe('shouldReportRead', () => {
  const looking = { windowActive: true, atEnd: true, newestSeq: 9, reportedSeq: 5 };

  it('reports when the window is active, the end is on screen and there is something new', () => {
    expect(shouldReportRead(looking)).toBe(true);
  });

  it('does not report while the window is hidden or not focused', () => {
    expect(shouldReportRead({ ...looking, windowActive: false })).toBe(false);
  });

  it('does not report while the user is scrolled away from the newest message', () => {
    expect(shouldReportRead({ ...looking, atEnd: false })).toBe(false);
  });

  it('does not report a position that is already confirmed', () => {
    expect(shouldReportRead({ ...looking, newestSeq: 5 })).toBe(false);
    expect(shouldReportRead({ ...looking, newestSeq: 4 })).toBe(false);
  });

  it('reports the moment the missing input arrives', () => {
    const blurred = { ...looking, windowActive: false };
    const scrolledUp = { ...looking, atEnd: false };

    expect(shouldReportRead(blurred)).toBe(false);
    expect(shouldReportRead({ ...blurred, windowActive: true })).toBe(true);
    expect(shouldReportRead(scrolledUp)).toBe(false);
    expect(shouldReportRead({ ...scrolledUp, atEnd: true })).toBe(true);
  });
});
