import { useCallback, useRef, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { addDays, addMinutes } from 'date-fns';
import { SLOT_MINUTES, toInstantIso } from '../lib/calendar-date';

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

/**
 * Що саме тягнуть. Двох режимів resize (а не одного «resize») вимагає сама
 * задача: «зустріч почалась раніше» — це половина правок часу, і робити її
 * через форму, коли нижній край тягнеться мишею, — асиметрія без причини.
 */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

/** Скільки пікселів вважаємо тремтінням руки, а не перетягуванням */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Автоскрол під час перетягування (ідея з calendarcn / Notion Calendar,
 * docs/calendar.md §11.9): курсор у цій зоні від краю прокрутки — сітка їде
 * сама. Без нього перенести подію з 9:00 на 18:00 неможливо взагалі: видимих
 * годин у сітці приблизно десять, а жест не можна поставити на паузу, щоб
 * покрутити колесо.
 */
const AUTO_SCROLL_ZONE_PX = 60;

/** Пікселів за кадр у самого краю; ближче до межі зони — пропорційно менше */
const AUTO_SCROLL_MAX_SPEED_PX = 12;

/**
 * Edge navigation (ідея з calendarcn): подію тримають біля лівого/правого краю
 * сітки — і календар сам перегортає період, не відпускаючи жест. Без цього
 * перенести зустріч на наступний тиждень можна лише «вирізати і вставити»
 * через форму.
 *
 * Затримка обовʼязкова: без неї кожен рух, що зайшов у крайню зону (а туди
 * заходять просто цілячись у суботу), перегортав би тиждень.
 */
const EDGE_ZONE_PX = 36;
const EDGE_DELAY_MS = 600;
const EDGE_REPEAT_MS = 900;

/** Куди перегортати: -1 ліворуч, 1 праворуч, 0 — курсор не в крайній зоні */
export function edgeDirection(x: number, rect: { left: number; right: number }): -1 | 0 | 1 {
  if (x < rect.left + EDGE_ZONE_PX) {
    return -1;
  }
  if (x > rect.right - EDGE_ZONE_PX) {
    return 1;
  }
  return 0;
}

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

  // Тягнуть нижній край: рухається кінець, початок стоїть на місці.
  //
  // `dayShift` тут теж застосовується — ним тягнуть КРАЙ БАГАТОДЕННОЇ СМУГИ
  // (all-day у тижневому рядку і в місяці): «відпустка до пʼятниці» стає
  // «до понеділка» без відкривання форми. У часовій сітці цей зсув завжди
  // нульовий, бо `snapDelta` не міряє дні в режимах resize
  if (mode === 'resize-end') {
    const moved = addMinutes(addDays(end, delta.dayShift), delta.minutes);
    // Мінімальна тривалість — один слот (а для смуги — доба, бо `dayShift`
    // цілочисельний): нульова чи відʼємна подія неможлива
    const floor = addMinutes(start, SLOT_MINUTES);
    return {
      startsAt: toInstantIso(start),
      endsAt: toInstantIso(moved.getTime() < floor.getTime() ? floor : moved),
    };
  }

  // Тягнуть верхній край: дзеркально — рухається початок, обмежений стелею
  // «кінець мінус слот». Межі МІСЦЯМИ НЕ МІНЯЮТЬСЯ (на відміну від створення
  // протягуванням, `use-range-draft`): там жест народжує інтервал і напрямок
  // ще не визначено, а тут у події вже є початок і кінець, і перекидання
  // означало б, що потягнувши верх униз, людина зсунула низ — чого вона не робила
  if (mode === 'resize-start') {
    const moved = addMinutes(addDays(start, delta.dayShift), delta.minutes);
    const ceiling = addMinutes(end, -SLOT_MINUTES);
    return {
      startsAt: toInstantIso(moved.getTime() > ceiling.getTime() ? ceiling : moved),
      endsAt: toInstantIso(end),
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
  snap: (dx: number, dy: number) => DragDelta;
  originX: number;
  originY: number;
  /**
   * Скільки пікселів прокрутки додав САМ автоскрол за цей жест. Компенсувати
   * треба саме його: сітка їде під курсором, тож та сама координата вікна
   * означає вже інший час.
   *
   * Спершу тут лежав `scrollTop` на початку жесту, а зсув рахувався як різниця
   * з поточним — і це виявилось помилкою, щойно зʼявилось перегортання періоду:
   * перемальована сітка сама скролиться до робочих годин, і ця РІЗНИЦЯ
   * зчитувалась як вертикальний рух курсора. У браузері це виглядало так:
   * подію перетягнули на наступний тиждень, а її час поїхав із 12:00 на 03:00.
   * Тепер зовнішні зміни прокрутки (перегортання, колесо мишки під час жесту)
   * на арифметику не впливають взагалі.
   */
  autoScrolled: number;
}

export interface EventDragApi {
  /** Активне перетягування — сітка малює по ньому зсув плитки */
  preview: (DragDelta & { key: string; mode: DragMode }) | null;
  begin: (
    pointer: { clientX: number; clientY: number; button: number; pointerId: number },
    item: DragItem,
    mode: DragMode,
    /**
     * Пікселі → зсув. Функцією, а не геометрією: сітка часу міряє вертикаль
     * ХВИЛИНАМИ (`snapDelta`), а місяць — ДНЯМИ (`monthDayShift`), і зшивати ці
     * дві арифметики в один об'єкт геометрії означало б розгалуження всередині
     * хука за ознакою, про яку він не має знати. Механіка жесту (порог,
     * автоскрол, придушення кліку) лишається спільною.
     */
    snap: (dx: number, dy: number) => DragDelta,
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
  /** Контейнер прокрутки сітки — потрібен лише автоскролу; без нього хук працює */
  scrollRef?: React.RefObject<HTMLElement | null>,
  /**
   * Перегортання періоду, коли подію тримають біля краю. Сітка після цього
   * показує інші дні, а зсув жесту хук доповнює сам — тижнями, які вже
   * перегорнув (`navigatedRef`), інакше подія «поїхала б назад» на стільки ж
   */
  onEdgeNavigate?: (direction: -1 | 1) => void,
): EventDragApi {
  const [preview, setPreview] = useState<EventDragApi['preview']>(null);
  const stateRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);
  /** Остання позиція курсора: її читає і `pointermove`, і кадр автоскролу */
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  /** Скільки ДНІВ уже додали перегортання періоду за цей жест */
  const navigatedRef = useRef(0);
  /** Коли можна перегорнути наступного разу (0 — щойно зайшли в зону) */
  const edgeDueRef = useRef(0);

  const begin = useCallback<EventDragApi['begin']>(
    (pointer, item, mode, snap) => {
      // Тільки основна кнопка: правий клік лишається за контекстним меню (CAL-2)
      if (pointer.button !== 0) {
        return;
      }
      stateRef.current = {
        ...item,
        mode,
        snap,
        originX: pointer.clientX,
        originY: pointer.clientY,
        autoScrolled: 0,
      };
      pointerRef.current = { x: pointer.clientX, y: pointer.clientY };
      draggedRef.current = false;
      navigatedRef.current = 0;
      edgeDueRef.current = 0;

      /** Порахувати зсув від останньої відомої позиції курсора і стану прокрутки */
      const currentDelta = (): DragDelta | null => {
        const state = stateRef.current;
        if (!state) {
          return null;
        }
        const dx = pointerRef.current.x - state.originX;
        const dy = pointerRef.current.y - state.originY + state.autoScrolled;
        if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return null;
        }
        draggedRef.current = true;
        const delta = state.snap(dx, dy);
        // Перегорнуті тижні додаються ПОВЕРХ зсуву курсора: сітка вже показує
        // інші дні, і без цієї добавки подія лишилась би на місці
        return { ...delta, dayShift: delta.dayShift + navigatedRef.current };
      };

      const render = (): void => {
        const state = stateRef.current;
        const delta = currentDelta();
        if (!state || !delta) {
          return;
        }
        setPreview({ key: state.key, mode: state.mode, ...delta });
      };

      /**
       * Кадр автоскролу. Живе окремо від `pointermove` навмисно: курсор може
       * СТОЯТИ біля краю нерухомо, і саме тоді сітка мусить продовжувати їхати —
       * рухів мишею більше не буде, а події ще не видно.
       */
      const tick = (): void => {
        const scroller = scrollRef?.current;
        if (!stateRef.current || !scroller) {
          rafRef.current = null;
          return;
        }
        if (draggedRef.current) {
          const rect = scroller.getBoundingClientRect();

          // Перегортання періоду: лише в режимі переносу — тягнучи КРАЙ події,
          // людина міняє тривалість у межах видимого періоду, а не їде з нього
          if (onEdgeNavigate && stateRef.current.mode === 'move') {
            const direction = edgeDirection(pointerRef.current.x, rect);
            const now = performance.now();
            if (direction === 0) {
              edgeDueRef.current = 0;
            } else if (edgeDueRef.current === 0) {
              edgeDueRef.current = now + EDGE_DELAY_MS;
            } else if (now >= edgeDueRef.current) {
              edgeDueRef.current = now + EDGE_REPEAT_MS;
              navigatedRef.current += direction * 7;
              onEdgeNavigate(direction);
              render();
            }
          }

          const y = pointerRef.current.y;
          const speed =
            y < rect.top + AUTO_SCROLL_ZONE_PX
              ? -AUTO_SCROLL_MAX_SPEED_PX * (1 - Math.max(y - rect.top, 0) / AUTO_SCROLL_ZONE_PX)
              : y > rect.bottom - AUTO_SCROLL_ZONE_PX
                ? AUTO_SCROLL_MAX_SPEED_PX *
                  (1 - Math.max(rect.bottom - y, 0) / AUTO_SCROLL_ZONE_PX)
                : 0;
          if (speed !== 0) {
            const before = scroller.scrollTop;
            const max = scroller.scrollHeight - scroller.clientHeight;
            scroller.scrollTop = Math.min(Math.max(before + speed, 0), max);
            // Перемалювати лише коли сітка справді поїхала: на впорі в межу
            // прокрутки координата не змінюється, і зайвий `setState` на кадр
            // дав би 60 ререндерів сітки на секунду ні за що
            if (scroller.scrollTop !== before) {
              stateRef.current.autoScrolled += scroller.scrollTop - before;
              render();
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      const handleMove = (moveEvent: PointerEvent): void => {
        pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        render();
      };

      const handleUp = (upEvent: PointerEvent): void => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        pointerRef.current = { x: upEvent.clientX, y: upEvent.clientY };
        const state = stateRef.current;
        const delta = currentDelta();
        stateRef.current = null;
        setPreview(null);
        if (!state || !draggedRef.current || !delta) {
          return;
        }
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
      if (scrollRef?.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [onCommit, onEdgeNavigate, scrollRef, timeZone],
  );

  const consumeDragged = useCallback((): boolean => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return { preview, begin, consumeDragged };
}
