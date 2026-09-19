import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const KEYBOARD_STEP_PX = 16;
/**
 * Вішається на `<html>` рівно на час активного pointer-драгу. `styles.css` гасить
 * нею `transition-[width]` реєстрового `sidebar.tsx` на `sidebar-gap`/`sidebar-container`
 * — інакше collapse-анімація (200мс) доганяє кожен кадр живого ресайзу, і контейнер,
 * що стискає AreaSidebar, візуально відстає від курсора. Поза драгом (клавіатура,
 * дабл-клік, звичайний collapse/expand) transition лишається — там плавність доречна.
 */
const RESIZING_CLASS = 'is-resizing-panel';

export function clampPanelWidth(value: number, minWidthPx: number, maxWidthPx: number): number {
  return Math.min(Math.max(value, minWidthPx), maxWidthPx);
}

export function readStoredPanelWidth(
  storageKey: string,
  minWidthPx: number,
  maxWidthPx: number,
  defaultWidthPx: number,
): number {
  const stored = window.localStorage.getItem(storageKey);
  const parsed = stored === null ? NaN : Number(stored);
  const initial = Number.isFinite(parsed) ? parsed : defaultWidthPx;
  return clampPanelWidth(initial, minWidthPx, maxWidthPx);
}

interface UseResizablePanelWidthOptions {
  /** CSS-змінна, яку хук виставляє на `document.documentElement` */
  cssVar: string;
  storageKey: string;
  defaultWidthPx: number;
  minWidthPx: number;
  /** Стеля — частка ширини viewport (0.4 = 40%) */
  maxRatio: number;
  /** У який бік екрана росте ширина при русі вказівника вправо */
  grow: 'right' | 'left';
}

interface ResizeHandleProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  tabIndex: 0;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Ширина панелі, що тягнеться мишею/клавіатурою і памʼятає себе між сесіями.
 *
 * Під час перетягування CSS-змінна мутується напряму на `document.documentElement`
 * (як `useRowReorder` — сирі pointer-події, без стану на кожен піксель): усі, хто
 * читає `var(--cssVar)` (обидва боки шела), оновлюються без ререндера Реакту.
 * Стан Реакту (і `localStorage`) комітиться лише на відпусканні/клавіші/дабл-кліку
 * — це і є «commit», а не проміжні кадри руху.
 */
export function useResizablePanelWidth({
  cssVar,
  storageKey,
  defaultWidthPx,
  minWidthPx,
  maxRatio,
  grow,
}: UseResizablePanelWidthOptions): ResizeHandleProps {
  const [maxWidthPx, setMaxWidthPx] = useState(() => Math.round(window.innerWidth * maxRatio));
  const [widthPx, setWidthPx] = useState(() =>
    readStoredPanelWidth(storageKey, minWidthPx, maxWidthPx, defaultWidthPx),
  );

  const apply = useCallback(
    (px: number) => {
      document.documentElement.style.setProperty(cssVar, `${String(px)}px`);
    },
    [cssVar],
  );

  const commit = useCallback(
    (px: number) => {
      setWidthPx(px);
      window.localStorage.setItem(storageKey, String(px));
    },
    [storageKey],
  );

  // Синхронно, до першого пейнта: інакше кадр встиг би показати CSS-фолбек
  // (`var(--cssVar, 14rem)`) і одразу стрибнути на збережену ширину
  useLayoutEffect(() => {
    apply(widthPx);
  }, []);

  // ResizeObserver, а не window.resize: реагує і на зміну самого контейнера
  // шела, не лише вікна
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const nextMax = Math.round(window.innerWidth * maxRatio);
      setMaxWidthPx(nextMax);
      setWidthPx((current) => {
        const clamped = clampPanelWidth(current, minWidthPx, nextMax);
        if (clamped !== current) {
          apply(clamped);
          window.localStorage.setItem(storageKey, String(clamped));
        }
        return clamped;
      });
    });
    observer.observe(document.documentElement);
    return () => {
      observer.disconnect();
    };
  }, [apply, maxRatio, minWidthPx, storageKey]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const resolveDragWidth = useCallback(
    (event: ReactPointerEvent<HTMLElement>, drag: { startX: number; startWidth: number }) => {
      const delta = event.clientX - drag.startX;
      const signedDelta = grow === 'right' ? delta : -delta;
      return clampPanelWidth(drag.startWidth + signedDelta, minWidthPx, maxWidthPx);
    },
    [grow, maxWidthPx, minWidthPx],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      document.documentElement.classList.add(RESIZING_CLASS);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
    },
    [widthPx],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      apply(resolveDragWidth(event, drag));
    },
    [apply, resolveDragWidth],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      document.documentElement.classList.remove(RESIZING_CLASS);
      if (!drag) {
        return;
      }
      commit(resolveDragWidth(event, drag));
    },
    [commit, resolveDragWidth],
  );

  const onDoubleClick = useCallback(() => {
    apply(defaultWidthPx);
    commit(defaultWidthPx);
  }, [apply, commit, defaultWidthPx]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const arrowSign = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
      if (arrowSign === null) {
        return;
      }
      event.preventDefault();
      const signedStep = (grow === 'right' ? arrowSign : -arrowSign) * KEYBOARD_STEP_PX;
      const next = clampPanelWidth(widthPx + signedStep, minWidthPx, maxWidthPx);
      apply(next);
      commit(next);
    },
    [apply, commit, grow, maxWidthPx, minWidthPx, widthPx],
  );

  return {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': Math.round(widthPx),
    'aria-valuemin': minWidthPx,
    'aria-valuemax': maxWidthPx,
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick,
    onKeyDown,
  };
}
