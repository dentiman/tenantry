import { describe, expect, it } from 'vitest';
import { applyDrag, edgeDirection, snapDelta, type DragGeometry } from './use-event-drag';

const geometry: DragGeometry = { hourHeight: 48, columnWidth: 200 };

describe('snapDelta', () => {
  it('прилипає до кроку 15 хвилин', () => {
    // 48px = година, отже 12px = 15 хв
    expect(snapDelta(0, 12, geometry, 'move')).toEqual({ minutes: 15, dayShift: 0 });
    // 5px — менше половини слота, заокруглюється до нуля
    expect(snapDelta(0, 5, geometry, 'move')).toEqual({ minutes: 0, dayShift: 0 });
    // 7px — більше половини, отже вже цілий слот
    expect(snapDelta(0, 7, geometry, 'move')).toEqual({ minutes: 15, dayShift: 0 });
  });

  it('рух угору дає відʼємні хвилини', () => {
    expect(snapDelta(0, -48, geometry, 'move').minutes).toBe(-60);
  });

  it('перенос по горизонталі рахує ЦІЛІ дні', () => {
    expect(snapDelta(200, 0, geometry, 'move').dayShift).toBe(1);
    expect(snapDelta(-420, 0, geometry, 'move').dayShift).toBe(-2);
    // Менше половини колонки — подія лишається у своєму дні
    expect(snapDelta(80, 0, geometry, 'move').dayShift).toBe(0);
  });

  it('зміна тривалості НІКОЛИ не міняє день', () => {
    expect(snapDelta(600, 24, geometry, 'resize-end').dayShift).toBe(0);
    expect(snapDelta(600, 24, geometry, 'resize-start').dayShift).toBe(0);
  });

  it('у режимі дня переносити нікуди — колонки немає', () => {
    expect(snapDelta(500, 0, { hourHeight: 48, columnWidth: 0 }, 'move').dayShift).toBe(0);
  });
});

describe('applyDrag', () => {
  const event = { startsAt: '2026-09-08T09:00:00.000Z', endsAt: '2026-09-08T10:00:00.000Z' };

  it('перенос зсуває обидві межі й зберігає тривалість', () => {
    const next = applyDrag(event, { minutes: 30, dayShift: 0 }, 'move', 'UTC');
    expect(next).toEqual({
      startsAt: '2026-09-08T09:30:00.000Z',
      endsAt: '2026-09-08T10:30:00.000Z',
    });
  });

  it('перенос на інший день лишає той самий час доби', () => {
    const next = applyDrag(event, { minutes: 0, dayShift: 2 }, 'move', 'UTC');
    expect(next.startsAt).toBe('2026-09-10T09:00:00.000Z');
    expect(next.endsAt).toBe('2026-09-10T10:00:00.000Z');
  });

  it('resize-end рухає тільки кінець', () => {
    const next = applyDrag(event, { minutes: 30, dayShift: 0 }, 'resize-end', 'UTC');
    expect(next).toEqual({
      startsAt: '2026-09-08T09:00:00.000Z',
      endsAt: '2026-09-08T10:30:00.000Z',
    });
  });

  it('resize-start рухає тільки початок', () => {
    const next = applyDrag(event, { minutes: -30, dayShift: 0 }, 'resize-start', 'UTC');
    expect(next).toEqual({
      startsAt: '2026-09-08T08:30:00.000Z',
      endsAt: '2026-09-08T10:00:00.000Z',
    });
  });

  it('resize-end не дає стягнути подію коротше за слот', () => {
    const next = applyDrag(event, { minutes: -120, dayShift: 0 }, 'resize-end', 'UTC');
    // Підлога — «початок плюс один слот», а не нуль і не відʼємна тривалість
    expect(next.endsAt).toBe('2026-09-08T09:15:00.000Z');
  });

  it('resize-start упирається в стелю «кінець мінус слот»', () => {
    const next = applyDrag(event, { minutes: 120, dayShift: 0 }, 'resize-start', 'UTC');
    expect(next.startsAt).toBe('2026-09-08T09:45:00.000Z');
    expect(next.endsAt).toBe('2026-09-08T10:00:00.000Z');
  });

  it('межі місцями НЕ міняються (на відміну від створення протягуванням)', () => {
    const next = applyDrag(event, { minutes: 600, dayShift: 0 }, 'resize-start', 'UTC');
    expect(new Date(next.startsAt).getTime()).toBeLessThan(new Date(next.endsAt).getTime());
  });

  /**
   * Найдорожчий тест цього файлу. 25 жовтня 2026 Київ переходить на зимовий
   * час: доба має 25 годин. Подія 10:00 24-го, перенесена на день уперед,
   * мусить стати 10:00 25-го — тобто зсунутись на 25 годин інстанту, а не на 24.
   * У числах: 10:00 (UTC+3) = 07:00Z, наступного дня 10:00 (UTC+2) = 08:00Z.
   */
  it('перенос через межу переходу на зимовий час зберігає час доби', () => {
    const beforeDst = {
      startsAt: '2026-10-24T07:00:00.000Z',
      endsAt: '2026-10-24T08:00:00.000Z',
    };
    const next = applyDrag(beforeDst, { minutes: 0, dayShift: 1 }, 'move', 'Europe/Kyiv');
    expect(next.startsAt).toBe('2026-10-25T08:00:00.000Z');
    expect(next.endsAt).toBe('2026-10-25T09:00:00.000Z');
  });

  /** Дзеркальний випадок: 29 березня 2026 доба в Києві коротша на годину */
  it('перенос через межу переходу на літній час зберігає час доби', () => {
    const beforeDst = {
      startsAt: '2026-03-28T08:00:00.000Z',
      endsAt: '2026-03-28T09:00:00.000Z',
    };
    const next = applyDrag(beforeDst, { minutes: 0, dayShift: 1 }, 'move', 'Europe/Kyiv');
    expect(next.startsAt).toBe('2026-03-29T07:00:00.000Z');
  });

  /**
   * Край БАГАТОДЕННОЇ СМУГИ тягнеться днями — тим самим `dayShift`, яким
   * переносять подію. All-day «14–16» (кінець ексклюзивний) із зсувом +1 стає
   * «14–17»; сервер нормалізує межі до опівночі власної зони події.
   */
  it('resize-end зсуває кінець смуги на дні', () => {
    const allDay = {
      startsAt: '2026-09-13T21:00:00.000Z',
      endsAt: '2026-09-15T21:00:00.000Z',
    };
    const next = applyDrag(allDay, { minutes: 0, dayShift: 1 }, 'resize-end', 'Europe/Kyiv');
    expect(next.startsAt).toBe('2026-09-13T21:00:00.000Z');
    expect(next.endsAt).toBe('2026-09-16T21:00:00.000Z');
  });

  it('resize-start зсуває початок смуги на дні', () => {
    const allDay = {
      startsAt: '2026-09-13T21:00:00.000Z',
      endsAt: '2026-09-15T21:00:00.000Z',
    };
    const next = applyDrag(allDay, { minutes: 0, dayShift: -2 }, 'resize-start', 'Europe/Kyiv');
    expect(next.startsAt).toBe('2026-09-11T21:00:00.000Z');
    expect(next.endsAt).toBe('2026-09-15T21:00:00.000Z');
  });

  it('смугу не можна стягнути в нуль: лишається щонайменше слот', () => {
    const allDay = {
      startsAt: '2026-09-13T21:00:00.000Z',
      endsAt: '2026-09-14T21:00:00.000Z',
    };
    const next = applyDrag(allDay, { minutes: 0, dayShift: -3 }, 'resize-end', 'Europe/Kyiv');
    expect(next.endsAt).toBe('2026-09-13T21:15:00.000Z');
  });

  it('зона глядача не впливає на подію, яку тягнуть у межах доби', () => {
    const next = applyDrag(event, { minutes: 15, dayShift: 0 }, 'move', 'America/New_York');
    expect(next.startsAt).toBe('2026-09-08T09:15:00.000Z');
  });
});

describe('edgeDirection', () => {
  const rect = { left: 100, right: 900 };

  it('у середині сітки перегортати нічого', () => {
    expect(edgeDirection(500, rect)).toBe(0);
  });

  it('біля лівого краю — назад, біля правого — вперед', () => {
    expect(edgeDirection(110, rect)).toBe(-1);
    expect(edgeDirection(890, rect)).toBe(1);
  });

  it('за самою межею зони ще не перегортає', () => {
    // Зона 36px: 136 — уже поза нею
    expect(edgeDirection(140, rect)).toBe(0);
    expect(edgeDirection(860, rect)).toBe(0);
  });
});
