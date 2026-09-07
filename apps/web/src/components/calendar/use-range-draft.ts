import { useCallback, useRef, useState } from 'react';
import { SLOT_MINUTES } from '../../lib/calendar-date';

/**
 * Створення події протягуванням по порожній сітці (CAL-2).
 *
 * Окремий хук, а не режим `useEventDrag`: там жест ЗСУВАЄ наявні межі (і має
 * знати про плитку, її ключ і колонку дня), тут — НАРОДЖУЄ інтервал із двох
 * координат у межах однієї колонки. Спільного між ними лишається тільки
 * прилипання до кроку, а воно й так живе в `SLOT_MINUTES`.
 *
 * Одна колонка навмисно: у Google/Outlook протягування через межу дня створює
 * не «подію з вечора до ранку», а плутанину — інтервал через кілька колонок
 * виглядав би як прямокутник, а означав би зовсім інші межі. Багатоденну подію
 * робить форма (там дата початку і кінця — окремі поля).
 */

/** Скільки пікселів вважаємо тремтінням руки, а не протягуванням */
export const RANGE_DRAFT_THRESHOLD_PX = 4;

export interface RangeDraft {
  /** Ключ дня — та сама форма, що в `dayKey`: колонка адресується ним */
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Пікселі від верху колонки → хвилина доби, прилипла до кроку сітки.
 *
 * Ділимо на ПОВНУ висоту колонки, а не на висоту години: сітка розкладає плитки
 * у відсотках від `minutesInDay` (`slotStyle`), і в добу переходу на зимовий час
 * там 1500 хвилин на ті самі 24 ряди. Порахувавши через висоту години, чернетка
 * поїхала б відносно вже намальованих подій саме того дня.
 */
export function minutesAtOffset(
  offsetY: number,
  columnHeight: number,
  minutesInDay: number,
): number {
  if (columnHeight <= 0) {
    return 0;
  }
  const raw = (offsetY / columnHeight) * minutesInDay;
  const snapped = Math.round(raw / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(Math.max(snapped, 0), minutesInDay);
}

/**
 * Дві хвилини (натиснули / тримаємо) → інтервал. Тягнути вгору дозволено:
 * людина часто починає з кінця («до обіду»), і забороняти це нема причин —
 * межі просто міняються місцями.
 *
 * Чиста функція, як `snapDelta` і `layoutOverlaps`: уся арифметика жесту
 * перевіряється без DOM.
 */
export function draftRange(
  anchorMinutes: number,
  cursorMinutes: number,
  minutesInDay: number,
): { startMinutes: number; endMinutes: number } {
  const start = Math.min(anchorMinutes, cursorMinutes);
  const end = Math.max(anchorMinutes, cursorMinutes);
  if (end - start >= SLOT_MINUTES) {
    return { startMinutes: start, endMinutes: end };
  }
  // Коротший за слот інтервал розтягуємо вниз, а на самому дні доби — вгору:
  // події нульової тривалості модель не має
  if (start + SLOT_MINUTES <= minutesInDay) {
    return { startMinutes: start, endMinutes: start + SLOT_MINUTES };
  }
  return { startMinutes: minutesInDay - SLOT_MINUTES, endMinutes: minutesInDay };
}

export interface RangeDraftContext {
  dayKey: string;
  /** Колонка дня — саме елемент, а не її координати: див. коментар у `begin` */
  column: HTMLElement;
  minutesInDay: number;
}

export interface RangeDraftApi {
  /** Активна чернетка — сітка малює по ній прямокутник */
  draft: RangeDraft | null;
  begin: (
    pointer: { clientY: number; button: number },
    context: RangeDraftContext,
  ) => void;
  /**
   * Чи щойно завершилось протягування. Комірка години перевіряє це у своєму
   * `onClick`: `pointerup` після руху все одно породжує `click`, і без перевірки
   * кожне протягування створювало б ДРУГУ подію — на годину, з якої почали.
   */
  consumeDragged: () => boolean;
}

export function useRangeDraft(onCommit: (draft: RangeDraft) => void): RangeDraftApi {
  const [draft, setDraft] = useState<RangeDraft | null>(null);
  const stateRef = useRef<(RangeDraftContext & { anchor: number; originY: number }) | null>(null);
  const draggedRef = useRef(false);

  const begin = useCallback<RangeDraftApi['begin']>(
    (pointer, context) => {
      // Тільки основна кнопка: правий клік лишається за контекстним меню (CAL-2)
      if (pointer.button !== 0) {
        return;
      }
      /**
       * Верх колонки читаємо на КОЖНОМУ русі, а не запамʼятовуємо на початку:
       * сітка живе у власному скролі, і прокрутка колесом посеред жесту зсунула б
       * усю систему координат. Один `getBoundingClientRect` на pointermove —
       * дешевше за помилку на пів дня.
       */
      const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top;
      const heightOf = (element: HTMLElement): number => element.getBoundingClientRect().height;

      stateRef.current = {
        ...context,
        anchor: minutesAtOffset(
          pointer.clientY - topOf(context.column),
          heightOf(context.column),
          context.minutesInDay,
        ),
        originY: pointer.clientY,
      };
      draggedRef.current = false;

      const cursorMinutes = (clientY: number): number => {
        const state = stateRef.current;
        if (!state) {
          return 0;
        }
        return minutesAtOffset(
          clientY - topOf(state.column),
          heightOf(state.column),
          state.minutesInDay,
        );
      };

      const handleMove = (moveEvent: PointerEvent): void => {
        const state = stateRef.current;
        if (!state) {
          return;
        }
        if (
          !draggedRef.current &&
          Math.abs(moveEvent.clientY - state.originY) < RANGE_DRAFT_THRESHOLD_PX
        ) {
          return;
        }
        draggedRef.current = true;
        setDraft({
          dayKey: state.dayKey,
          ...draftRange(state.anchor, cursorMinutes(moveEvent.clientY), state.minutesInDay),
        });
      };

      const handleUp = (upEvent: PointerEvent): void => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        const state = stateRef.current;
        const dragged = draggedRef.current;
        const minutes = dragged ? cursorMinutes(upEvent.clientY) : 0;
        stateRef.current = null;
        setDraft(null);
        if (!state || !dragged) {
          return;
        }
        onCommit({
          dayKey: state.dayKey,
          ...draftRange(state.anchor, minutes, state.minutesInDay),
        });
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [onCommit],
  );

  const consumeDragged = useCallback((): boolean => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return { draft, begin, consumeDragged };
}
