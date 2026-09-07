import { useEffect, useRef } from 'react';
import { CALENDAR_VIEWS, type CalendarView } from '../../lib/calendar-date';

/**
 * Гарячі клавіші календаря (CAL-2, F-34). Розкладка Google-сумісна: `T` today,
 * `D`/`W`/`M`/`A` перегляди, `←`/`→` період, `N` нова подія, `?` довідка.
 *
 * Слухач один і на `window`: комірки сітки не мусять бути у фокусі, щоб `W`
 * перемкнув тиждень — людина щойно дивилась на календар, а не «стояла» на
 * елементі. Ціна такого рішення — два фільтри нижче (`enabled` і
 * `isEditableTarget`), без яких набір назви події перегортав би тижні.
 */

export type CalendarHotkeyAction =
  | { kind: 'today' }
  | { kind: 'view'; view: CalendarView }
  | { kind: 'shift'; direction: -1 | 1 }
  | { kind: 'create' }
  | { kind: 'help' };

/** Перша літера перегляду — вона ж його клавіша: `d`, `w`, `m`, `a` */
const VIEW_BY_KEY = new Map<string, CalendarView>(
  CALENDAR_VIEWS.map((view) => [view.slice(0, 1), view]),
);

/**
 * Клавіша → дія. Чиста функція (як `snapDelta` і `draftRange`): саме тут живе
 * вся розкладка, і перевірити її можна без DOM.
 *
 * `event.key`, а не `code`: він уже враховує розкладку і `Shift`, тому `?`
 * приходить готовим символом, а не парою «Shift + slash», яка на різних
 * розкладках лежить на різних фізичних клавішах.
 *
 * Будь-який модифікатор (крім `Shift`, що бере участь у самому символі) знімає
 * обробку: `Cmd+D` — закладка браузера, `Alt+←` — його ж «назад», і
 * перевизначати їх календар не має права.
 */
export function resolveHotkey(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): CalendarHotkeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  // `Shift`+`/` приймаємо ОКРЕМО від готового `?`: у частині розкладок і
  // середовищ автоматизації `key` лишається `/` навіть із затиснутим `Shift`
  // (спіймано в браузері), і без цієї гілки довідка була б недосяжна саме там
  if (event.key === '?' || (event.shiftKey && event.key === '/')) {
    return { kind: 'help' };
  }
  if (event.key === 'ArrowLeft') {
    return { kind: 'shift', direction: -1 };
  }
  if (event.key === 'ArrowRight') {
    return { kind: 'shift', direction: 1 };
  }

  const key = event.key.toLowerCase();
  if (key === 't') {
    return { kind: 'today' };
  }
  if (key === 'n' || key === 'c') {
    // `C` — теж «create»: у Google обидві клавіші роблять те саме, і людина,
    // яка прийшла звідти, натисне ту, до якої звикла
    return { kind: 'create' };
  }
  const view = VIEW_BY_KEY.get(key);
  return view ? { kind: 'view', view } : null;
}

/**
 * Чи фокус у полі введення. Без цієї перевірки набір назви події перегортав би
 * календар під панеллю: слухач на `window` бачить КОЖНЕ натискання.
 *
 * `isContentEditable` окремо від тегів: у майбутньому редакторі опису події
 * тегом буде `div`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useCalendarHotkeys(
  enabled: boolean,
  onAction: (action: CalendarHotkeyAction) => void,
): void {
  // Колбек через ref: інакше кожен рендер сторінки (а він відбувається на
  // кожну зміну вікна) перепідписував би слухача
  const handlerRef = useRef(onAction);
  useEffect(() => {
    handlerRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const action = resolveHotkey(event);
      if (!action) {
        return;
      }
      // `preventDefault` лише для розпізнаної клавіші: інакше ми з'їдали б
      // прокрутку стрілками і пошук по сторінці
      event.preventDefault();
      handlerRef.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
