import { describe, expect, it } from 'vitest';
import { findConflicts, type ConflictEvent } from './find-conflicts';

/** Подія, яка ЗАЙМАЄ час: усі виключення нижче перебивають одне поле */
const busyEvent = (over: Partial<ConflictEvent> & { id: string }): ConflictEvent => ({
  title: over.id,
  startsAt: '2026-09-08T10:00:00.000Z',
  endsAt: '2026-09-08T11:00:00.000Z',
  allDay: false,
  busy: true,
  status: 'CONFIRMED',
  myResponse: 'ACCEPTED',
  ...over,
});

const range = { startsAt: '2026-09-08T10:30:00.000Z', endsAt: '2026-09-08T11:30:00.000Z' };

describe('findConflicts', () => {
  it('знаходить подію, що перетинає діапазон', () => {
    const found = findConflicts(range, [busyEvent({ id: 'a' })], null);
    expect(found.map((event) => event.id)).toEqual(['a']);
  });

  /**
   * Межі ПІВ-ВІДКРИТІ, як і в моделі: 10:00–11:00 і 11:00–12:00 стоять
   * впритул, але конфліктом не є. Це рівно те правило, яке ламають
   * рефакторингом на `<=`.
   */
  it('дотик межами конфліктом НЕ є', () => {
    const after = busyEvent({
      id: 'after',
      startsAt: '2026-09-08T11:30:00.000Z',
      endsAt: '2026-09-08T12:30:00.000Z',
    });
    const before = busyEvent({
      id: 'before',
      startsAt: '2026-09-08T09:30:00.000Z',
      endsAt: '2026-09-08T10:30:00.000Z',
    });
    expect(findConflicts(range, [after, before], null)).toEqual([]);
  });

  it('подія, що повністю накриває діапазон, конфліктує', () => {
    const around = busyEvent({
      id: 'around',
      startsAt: '2026-09-08T08:00:00.000Z',
      endsAt: '2026-09-08T20:00:00.000Z',
    });
    expect(findConflicts(range, [around], null).map((event) => event.id)).toEqual(['around']);
  });

  it('сама редагована подія не конфліктує сама з собою', () => {
    expect(findConflicts(range, [busyEvent({ id: 'self' })], 'self')).toEqual([]);
  });

  it('скасована подія часу не займає', () => {
    expect(findConflicts(range, [busyEvent({ id: 'a', status: 'CANCELLED' })], null)).toEqual([]);
  });

  it('busy: false (TRANSP) — «показувати мене вільним»', () => {
    expect(findConflicts(range, [busyEvent({ id: 'a', busy: false })], null)).toEqual([]);
  });

  it('all-day накрила б кожну подію дня, тому виключена', () => {
    expect(findConflicts(range, [busyEvent({ id: 'a', allDay: true })], null)).toEqual([]);
  });

  it('мій DECLINED — я вже сказав, що не буду', () => {
    expect(findConflicts(range, [busyEvent({ id: 'a', myResponse: 'DECLINED' })], null)).toEqual([]);
  });

  it('подія без моєї участі (myResponse: null) конфліктує — це моя ж подія', () => {
    expect(
      findConflicts(range, [busyEvent({ id: 'a', myResponse: null })], null).map((e) => e.id),
    ).toEqual(['a']);
  });

  it('невалідний діапазон нічого не шукає', () => {
    const reversed = { startsAt: range.endsAt, endsAt: range.startsAt };
    expect(findConflicts(reversed, [busyEvent({ id: 'a' })], null)).toEqual([]);
    const zero = { startsAt: range.startsAt, endsAt: range.startsAt };
    expect(findConflicts(zero, [busyEvent({ id: 'a' })], null)).toEqual([]);
    const broken = { startsAt: 'не дата', endsAt: range.endsAt };
    expect(findConflicts(broken, [busyEvent({ id: 'a' })], null)).toEqual([]);
  });

  it('результат відсортований за початком', () => {
    const later = busyEvent({
      id: 'later',
      startsAt: '2026-09-08T11:00:00.000Z',
      endsAt: '2026-09-08T12:00:00.000Z',
    });
    const earlier = busyEvent({ id: 'earlier' });
    expect(findConflicts(range, [later, earlier], null).map((event) => event.id)).toEqual([
      'earlier',
      'later',
    ]);
  });
});
