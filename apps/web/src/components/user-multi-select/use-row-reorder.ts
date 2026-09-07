import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Проміжок між рядками списку (`gap-1.5`) — крок додається до висоти рядка */
const ROW_GAP = 6;
/** Скільки треба протягнути, перш ніж жест стане перетягуванням, а не кліком */
const START_THRESHOLD = 4;

interface RowReorder {
  /** id рядка, який зараз у руці (для стилю «піднято») */
  dragId: string | null;
  handleProps: (id: string) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * Перетягування рядків списку на СИРИХ pointer-подіях — те саме рішення, що в
 * календарній сітці (`docs/calendar.md`): у вертикальному списку немає ні зон,
 * ні колізій, є координата, яку заокруглюють до кроку. Бібліотека рівня
 * `@dnd-kit` принесла б власну модель сенсорів і власні стилі заради
 * арифметики в десять рядків.
 *
 * Порядок міняється НА ЛЬОТУ, щойно вказівник перетнув межу сусіда, а не в
 * момент відпускання: піднятий рядок лишається на своєму місці в потоці, тож
 * окремого «привида» під курсором малювати не треба — видно рівно той список,
 * який збережеться.
 *
 * Крок міряється з живого DOM, а не з константи: варіанти рядка (`card` 48px,
 * `flat` 44px) мають різну висоту, і зашитий крок у другому з них промахувався б.
 */
export function useRowReorder(
  value: string[],
  onChange: (next: string[]) => void,
  enabled: boolean,
  lockedIds: string[],
): RowReorder {
  const [dragId, setDragId] = useState<string | null>(null);
  // Сесія жесту в ref, а не в стані: вона змінюється на кожному русі вказівника
  // і не малює нічого сама — перерендер на неї був би марною роботою
  const session = useRef<{ id: string; anchorY: number; pitch: number } | null>(null);
  // Останнє значення для обробників: pointermove живе довше за рендер, у якому
  // його підписали, і замикання на `value` віддавало б порядок «до» жесту
  const latest = useRef(value);
  latest.current = value;
  const locked = useRef(lockedIds);
  locked.current = lockedIds;

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled) {
          return;
        }
        // preventDefault: інакше браузер починає власне виділення тексту, і
        // рядок «залипає» під курсором у вигляді напівпрозорого знімка
        event.preventDefault();
        const row = event.currentTarget.closest<HTMLElement>('[data-row]');
        const pitch = row ? row.getBoundingClientRect().height + ROW_GAP : 54;
        event.currentTarget.setPointerCapture(event.pointerId);
        session.current = { id, anchorY: event.clientY, pitch };
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const drag = session.current;
        if (drag?.id !== id) {
          return;
        }
        const delta = event.clientY - drag.anchorY;
        if (dragId === null && Math.abs(delta) < START_THRESHOLD) {
          return;
        }
        if (dragId === null) {
          setDragId(id);
        }
        const steps = Math.round(delta / drag.pitch);
        if (steps === 0) {
          return;
        }
        const current = latest.current;
        const from = current.indexOf(id);
        // Стеля зверху — не 0, а перший НЕзакріплений рядок: закріплені стоять
        // на початку списку (їх туди повертає `onValueChange`), і якби під них
        // можна було підпхнути звичайний рядок, слово «закріплений» брехало б
        const firstFree = current.findIndex((rowId) => !locked.current.includes(rowId));
        const minIndex = firstFree === -1 ? 0 : firstFree;
        const to = Math.max(minIndex, Math.min(current.length - 1, from + steps));
        if (to === from) {
          return;
        }
        // Перестановка вирізанням і вставкою, а не `splice` на місці: `splice`
        // повертає масив, який типи вважають потенційно порожнім, і кожен
        // виклик доводилось би прикривати асерцією — а її тут заборонено
        const without = current.filter((rowId) => rowId !== id);
        const next = [...without.slice(0, to), id, ...without.slice(to)];
        // Якір зсувається рівно на пройдені кроки, а не скидається в поточний Y:
        // інакше половина кроку, що лишилась «у руці», губилась би на кожному
        // обміні і рядок відставав би від вказівника
        drag.anchorY += (to - from) * drag.pitch;
        onChange(next);
      },
      onPointerUp: () => {
        session.current = null;
        setDragId(null);
      },
      onPointerCancel: () => {
        session.current = null;
        setDragId(null);
      },
    }),
    [dragId, enabled, onChange],
  );

  return { dragId, handleProps };
}
