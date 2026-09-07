import { useCallback, useRef, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { addDays, addMinutes } from 'date-fns';
import { SLOT_MINUTES, toInstantIso } from '../../lib/calendar-date';

/**
 * Перетягування і зміна тривалості події в сітці (CAL-2).
 *
 * Власні pointer-події, а не `@dnd-kit` (рішення §15.1): у часовій сітці немає
 * ні зон, ні колізій — є неперервна координата, яку треба заокруглити до кроку
 * 15 хв. Ми користувалися б лише pointer-сенсором бібліотеки, доплативши
 * залежністю і її моделлю подій.
 *
 * Клавіатурна доступність від цього не страждає: вся робота з подією доступна
 * через форму панелі, а перетягування лишається прискорювачем для миші
 * (docs/calendar.md §11.5 п.9).
 */

export type DragMode = 'move' | 'resize';

/** Скільки пікселів вважаємо тремтінням руки, а не перетягуванням */
export const DRAG_THRESHOLD_PX = 4;

export interface DragGeometry {
  /** Висота години в пікселях — та сама, що малює сітка */
  hourHeight: number;
  /** Ширина колонки дня; 0 у режимі дня (переносити нікуди) */
  columnWidth: number;
}

export interface DragDelta {
  minutes: number;
  dayShift: number;
}

/**
 * Пікселі → зсув, прилиплий до кроку сітки. Чиста функція навмисно: це єдине
 * місце з арифметикою, і воно перевіряється без DOM (як `layoutOverlaps`).
 */
export function snapDelta(
  dx: number,
  dy: number,
  geometry: DragGeometry,
  mode: DragMode,
): DragDelta {
  const minutes = Math.round(dy / geometry.hourHeight * 60 / SLOT_MINUTES) * SLOT_MINUTES;
  // Змінюючи тривалість, день не міняємо: подія лишається в своїй колонці
  const dayShift =
    mode === 'move' && geometry.columnWidth > 0 ? Math.round(dx / geometry.columnWidth) : 0;
  return { minutes, dayShift };
}

/**
 * Застосувати зсув до меж події. Дні додаються через `addDays` у зоні ГЛЯДАЧА,
 * а не «+24 години»: доба переходу на зимовий час має 25 годин, і перетягування
 * через таку межу зсунуло б подію на годину.
 */
export function applyDrag(
  event: { startsAt: string; endsAt: string },
  delta: DragDelta,
  mode: DragMode,
  timeZone: string,
): { startsAt: string; endsAt: string } {
  const start = new TZDate(new Date(event.startsAt), timeZone);
  const end = new TZDate(new Date(event.endsAt), timeZone);

  if (mode === 'resize') {
    const moved = addMinutes(end, delta.minutes);
    // Мінімальна тривалість — один слот: нульова чи відʼємна подія неможлива
    const floor = addMinutes(start, SLOT_MINUTES);
    return {
      startsAt: toInstantIso(start),
      endsAt: toInstantIso(moved.getTime() < floor.getTime() ? floor : moved),
    };
  }

  const shift = (value: TZDate): TZDate =>
    addMinutes(addDays(value, delta.dayShift), delta.minutes);
  return { startsAt: toInstantIso(shift(start)), endsAt: toInstantIso(shift(end)) };
}

export interface DragItem {
  /** `${id}:${occurrenceStart}` — той самий ключ, що в розкладці плиток */
  key: string;
  eventId: string;
  startsAt: string;
  endsAt: string;
}

export interface DragCommit extends DragItem {
  mode: DragMode;
  next: { startsAt: string; endsAt: string };
}

interface DragState extends DragItem {
  mode: DragMode;
  originX: number;
  originY: number;
  geometry: DragGeometry;
}

export interface EventDragApi {
  /** Активне перетягування — сітка малює по ньому зсув плитки */
  preview: (DragDelta & { key: string; mode: DragMode }) | null;
  begin: (
    pointer: { clientX: number; clientY: number; button: number; pointerId: number },
    item: DragItem,
    mode: DragMode,
    geometry: DragGeometry,
  ) => void;
  /**
   * Чи щойно завершилось перетягування. Плитка перевіряє це у своєму `onClick`:
   * `pointerup` після руху все одно породжує `click`, і без перевірки кожне
   * перенесення відкривало б панель події.
   */
  consumeDragged: () => boolean;
}

export function useEventDrag(
  timeZone: string,
  onCommit: (commit: DragCommit) => void,
): EventDragApi {
  const [preview, setPreview] = useState<EventDragApi['preview']>(null);
  const stateRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);

  const begin = useCallback<EventDragApi['begin']>(
    (pointer, item, mode, geometry) => {
      // Тільки основна кнопка: правий клік лишається за контекстним меню (CAL-2)
      if (pointer.button !== 0) {
        return;
      }
      stateRef.current = {
        ...item,
        mode,
        originX: pointer.clientX,
        originY: pointer.clientY,
        geometry,
      };
      draggedRef.current = false;

      const handleMove = (moveEvent: PointerEvent): void => {
        const state = stateRef.current;
        if (!state) {
          return;
        }
        const dx = moveEvent.clientX - state.originX;
        const dy = moveEvent.clientY - state.originY;
        if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return;
        }
        draggedRef.current = true;
        const delta = snapDelta(dx, dy, state.geometry, state.mode);
        setPreview({ key: state.key, mode: state.mode, ...delta });
      };

      const handleUp = (upEvent: PointerEvent): void => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        const state = stateRef.current;
        stateRef.current = null;
        setPreview(null);
        if (!state || !draggedRef.current) {
          return;
        }
        const delta = snapDelta(
          upEvent.clientX - state.originX,
          upEvent.clientY - state.originY,
          state.geometry,
          state.mode,
        );
        // Прилипання могло звести рух до нуля — тоді коміту немає, але клік
        // усе одно душимо: людина тягнула, а не натискала
        if (delta.minutes === 0 && delta.dayShift === 0) {
          return;
        }
        onCommit({
          key: state.key,
          eventId: state.eventId,
          startsAt: state.startsAt,
          endsAt: state.endsAt,
          mode: state.mode,
          next: applyDrag(state, delta, state.mode, timeZone),
        });
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [onCommit, timeZone],
  );

  const consumeDragged = useCallback((): boolean => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return { preview, begin, consumeDragged };
}
