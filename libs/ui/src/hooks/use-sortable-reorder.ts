import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Скільки треба протягнути, перш ніж жест стане перетягуванням, а не кліком */
export const REORDER_START_THRESHOLD = 4;

export interface ReorderSlot {
  id: string;
  /** Середина елемента вздовж осі — зі знімка на початку жесту */
  mid: number;
}

/**
 * Куди впаде елемент: id сусіда, ПЕРЕД яким він стане, або null — у кінець.
 * `others` — решта елементів (без того, що в руці) у поточному порядку, з
 * серединами, знятими на ПОЧАТКУ жесту. `position` — центр елемента в руці
 * (початковий центр + зсув вказівника). Знімок, а не живий DOM: у live-режимі
 * список переставляється під рукою, і живі середини давали б несиметричний
 * гістерезис (назад довелось би тягнути вдвічі далі, ніж уперед).
 * Перші `lockedCount` елементів закріплені — перед ними не вставити.
 */
export function resolveReorderTarget(
  others: readonly ReorderSlot[],
  position: number,
  lockedCount: number,
): string | null {
  const passed = others.filter((slot) => slot.mid < position).length;
  const index = Math.max(lockedCount, passed);
  return others[index]?.id ?? null;
}

/** Зона біля краю контейнера, де під час жесту вмикається автоскрол, і його стеля за кадр */
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_STEP = 14;

/**
 * Крок автоскролу за кадр: від'ємний — до початку, додатний — до кінця, 0 — поза
 * зонами. Швидкість росте, що ближче вказівник до краю (і за краєм — на максимумі).
 */
export function autoScrollStep(pointer: number, start: number, end: number): number {
  if (pointer < start + AUTO_SCROLL_EDGE) {
    const depth = Math.min(1, (start + AUTO_SCROLL_EDGE - pointer) / AUTO_SCROLL_EDGE);
    return -Math.ceil(depth * AUTO_SCROLL_MAX_STEP);
  }
  if (pointer > end - AUTO_SCROLL_EDGE) {
    const depth = Math.min(1, (pointer - (end - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
    return Math.ceil(depth * AUTO_SCROLL_MAX_STEP);
  }
  return 0;
}

/** Перестановка в масиві id: `id` стає перед `beforeId` (null — у кінець) */
export function moveBefore(ids: readonly string[], id: string, beforeId: string | null): string[] {
  const without = ids.filter((other) => other !== id);
  const index = beforeId === null ? without.length : without.indexOf(beforeId);
  const at = index === -1 ? without.length : index;
  return [...without.slice(0, at), id, ...without.slice(at)];
}

export interface SortableDrag {
  id: string;
  /** Поточна ціль: перед ким стане елемент (null — у кінець) */
  beforeId: string | null;
  /** Вказівник (client-координати) — для «привида» в drop-режимі */
  pointerX: number;
  pointerY: number;
  /** Зсув від точки захоплення — щоб привид тримався тієї ж точки елемента */
  offsetX: number;
  offsetY: number;
}

interface UseSortableReorderOptions {
  axis: 'x' | 'y';
  /** Учасники в поточному порядку */
  ids: readonly string[];
  /** Закріплені: їх не тягнуть і перед ними не кладуть (стоять на початку `ids`) */
  lockedIds?: readonly string[];
  enabled?: boolean;
  /**
   * live — `onMove` на кожну зміну цілі (список переставляється під рукою, привид
   * не потрібен); drop — один раз на відпусканні (показати лінію вставки й привид).
   */
  mode: 'live' | 'drop';
  onMove: (id: string, beforeId: string | null) => void;
  /**
   * Контейнер, що прокручується вздовж осі (обгортка широкої таблиці). Позиції тоді
   * рахуються з поправкою на його прокрутку, а біля країв під час жесту він
   * прокручується сам — інакше колонку не донести до тієї, що за краєм.
   */
  scrollContainer?: () => HTMLElement | null;
}

interface Session {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  /** Центр елемента в руці вздовж осі на старті */
  center: number;
  others: ReorderSlot[];
  lockedCount: number;
  /** Сусід, перед яким елемент стояв на старті — для Escape у live-режимі */
  originalBeforeId: string | null;
  /** Остання ціль, про яку вже повідомили / показали */
  beforeId: string | null;
  offsetX: number;
  offsetY: number;
  started: boolean;
  lastX: number;
  lastY: number;
  /** Прокрутка контейнера на старті — середини в `others` зняті при ній */
  scrollStart: number;
  frame: number | null;
}

/**
 * Перетягування на СИРИХ pointer-подіях по одній осі — спільне для рядків списку
 * (меню полів гріда, список учасників) і заголовків таблиці. Бібліотека рівня
 * `@dnd-kit` принесла б власну модель сенсорів і стилів заради арифметики вище.
 *
 * Слухачі — на `window`, а не pointer capture: захоплення перенаправило б `click`
 * з кнопки всередині елемента (сортування в заголовку) навіть при звичайному
 * кліку. Жест стартує лише після порогу; після справжнього перетягування
 * наступний `click` гаситься, щоб відпускання не сортувало й не перемикало.
 * Escape скасовує: у live-режимі повертає елемент на старе місце.
 */
export function useSortableReorder({
  axis,
  ids,
  lockedIds = [],
  enabled = true,
  mode,
  onMove,
  scrollContainer,
}: UseSortableReorderOptions) {
  const [drag, setDrag] = useState<SortableDrag | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const session = useRef<Session | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  // Останні опції для обробників на window: вони живуть довше за рендер, у якому
  // їх підписали, і замикання віддавало б порядок «до» жесту
  const latest = useRef({ ids, lockedIds, onMove, mode, axis, scrollContainer });
  latest.current = { ids, lockedIds, onMove, mode, axis, scrollContainer };

  useEffect(() => () => cleanup.current?.(), []);

  const itemRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) {
        elements.current.set(id, element);
      } else {
        elements.current.delete(id);
      }
    },
    [],
  );

  const getElement = useCallback((id: string) => elements.current.get(id), []);

  /** `pointerHeld` — жест скасовано, а кнопку ще тримають (Escape) */
  const finish = useCallback((commit: boolean, pointerHeld = false) => {
    const current = session.current;
    session.current = null;
    if (current?.frame != null) {
      cancelAnimationFrame(current.frame);
    }
    cleanup.current?.();
    cleanup.current = null;
    setDrag(null);
    if (!current?.started) {
      return;
    }
    document.body.style.userSelect = '';
    const { onMove: emit, mode: currentMode } = latest.current;
    if (currentMode === 'drop' && commit && current.beforeId !== current.originalBeforeId) {
      emit(current.id, current.beforeId);
    }
    if (currentMode === 'live' && !commit && current.beforeId !== current.originalBeforeId) {
      emit(current.id, current.originalBeforeId);
    }
    // Відпускання після перетягування не має стати кліком (сортування, toggle).
    // Після pointerup клік іде в тій самій задачі — гасимо його й знімаємо слухача
    // таймером. Після Escape кнопку ще тримають: гасимо клік НАСТУПНОГО відпускання
    const swallowNextClick = () => {
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener('click', swallow, { capture: true });
      }, 0);
    };
    if (commit) {
      swallowNextClick();
    } else if (pointerHeld) {
      window.addEventListener('pointerup', swallowNextClick, { capture: true, once: true });
    }
  }, []);

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        const { ids: order, lockedIds: locked, axis: currentAxis } = latest.current;
        if (!enabled || event.button !== 0 || locked.includes(id) || session.current) {
          return;
        }
        const element = elements.current.get(id);
        if (!element) {
          return;
        }
        const measure = (target: HTMLElement) => {
          const rect = target.getBoundingClientRect();
          return currentAxis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        };
        const rect = element.getBoundingClientRect();
        const others = order.flatMap((otherId) => {
          const other = elements.current.get(otherId);
          return otherId !== id && other ? [{ id: otherId, mid: measure(other) }] : [];
        });
        const index = order.indexOf(id);
        const originalBeforeId = order[index + 1] ?? null;
        const scrollOffset = () => {
          const container = latest.current.scrollContainer?.();
          if (!container) {
            return 0;
          }
          return latest.current.axis === 'x' ? container.scrollLeft : container.scrollTop;
        };
        session.current = {
          id,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          center: measure(element),
          others,
          lockedCount: others.filter((slot) => locked.includes(slot.id)).length,
          originalBeforeId,
          beforeId: originalBeforeId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          started: false,
          lastX: event.clientX,
          lastY: event.clientY,
          scrollStart: scrollOffset(),
          frame: null,
        };

        // Автоскрол: кадр за кадром, поки вказівник у зоні біля краю контейнера;
        // після кожного зсуву ціль перераховується з тим самим положенням вказівника
        const autoScroll = () => {
          const current = session.current;
          const container = latest.current.scrollContainer?.();
          if (!current || !container) {
            return;
          }
          current.frame = null;
          const box = container.getBoundingClientRect();
          const isX = latest.current.axis === 'x';
          const step = isX
            ? autoScrollStep(current.lastX, box.left, box.right)
            : autoScrollStep(current.lastY, box.top, box.bottom);
          if (step === 0) {
            return;
          }
          const before = scrollOffset();
          if (isX) {
            container.scrollLeft += step;
          } else {
            container.scrollTop += step;
          }
          if (scrollOffset() !== before) {
            update(current.lastX, current.lastY, false);
          }
          current.frame = requestAnimationFrame(autoScroll);
        };

        const update = (clientX: number, clientY: number, fromPointer: boolean) => {
          const current = session.current;
          if (!current) {
            return;
          }
          current.lastX = clientX;
          current.lastY = clientY;
          const dx = clientX - current.startX;
          const dy = clientY - current.startY;
          const delta = latest.current.axis === 'x' ? dx : dy;
          const justStarted = !current.started;
          if (justStarted) {
            if (Math.abs(delta) < REORDER_START_THRESHOLD) {
              return;
            }
            current.started = true;
            // Без цього браузер виділяє текст під рукою і тягне його знімок
            document.body.style.userSelect = 'none';
            window.getSelection()?.removeAllRanges();
          }
          if (fromPointer && current.frame === null && latest.current.scrollContainer) {
            current.frame = requestAnimationFrame(autoScroll);
          }
          // Середини зняті при scrollStart: прокрутка на N зсуває їх на −N, тож до
          // позиції додаємо N — порівняння лишається в координатах вмісту
          const beforeId = resolveReorderTarget(
            current.others,
            current.center + delta + (scrollOffset() - current.scrollStart),
            current.lockedCount,
          );
          const targetChanged = beforeId !== current.beforeId;
          if (targetChanged) {
            current.beforeId = beforeId;
            if (latest.current.mode === 'live') {
              latest.current.onMove(current.id, beforeId);
            }
          }
          // Live-режиму позиція вказівника не потрібна (привида немає) — стан лише
          // на старті й на зміні цілі, а не на кожен піксель. Drop-режим малює
          // привид під вказівником, тож оновлюється на кожному русі
          if (latest.current.mode === 'live' && !targetChanged && !justStarted) {
            return;
          }
          setDrag({
            id: current.id,
            beforeId: current.beforeId,
            pointerX: clientX,
            pointerY: clientY,
            offsetX: current.offsetX,
            offsetY: current.offsetY,
          });
        };

        const onPointerMove = (move: PointerEvent) => {
          if (session.current?.pointerId === move.pointerId) {
            update(move.clientX, move.clientY, true);
          }
        };
        const onPointerUp = (up: PointerEvent) => {
          if (session.current?.pointerId === up.pointerId) {
            finish(true);
          }
        };
        const onPointerCancel = () => {
          finish(false);
        };
        const onKeyDown = (key: KeyboardEvent) => {
          if (key.key === 'Escape' && session.current?.started) {
            key.preventDefault();
            key.stopPropagation();
            finish(false, true);
          }
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        // capture: Escape має скасувати жест раніше, ніж закриє popover навколо
        window.addEventListener('keydown', onKeyDown, { capture: true });
        cleanup.current = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerCancel);
          window.removeEventListener('keydown', onKeyDown, { capture: true });
        };
      },
    }),
    [enabled, finish],
  );

  return { drag, itemRef, handleProps, getElement };
}
