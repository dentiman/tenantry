import type { DragDelta } from './use-event-drag';

/**
 * Арифметика перетягування в МІСЯЦІ (docs/calendar.md §11.9).
 *
 * У часовій сітці вертикаль — це хвилини, а тут і горизонталь, і вертикаль
 * означають те саме: дні. Рядок місяця — рівно тиждень, тому зсув на один ряд
 * донизу це +7 днів, і жест «перетягнути з 3-го на 17-те» — це два ряди вниз
 * плюс одна колонка.
 *
 * Час доби при цьому НЕ змінюється (`minutes: 0`): у місяці немає координати
 * години, і вигадувати її з піксельної позиції означало б непомітно зсувати
 * зустрічі щоразу, коли людина просто перекладає їх на інший день.
 */
export function monthDayShift(
  dx: number,
  dy: number,
  cellWidth: number,
  rowHeight: number,
): number {
  const columns = cellWidth > 0 ? Math.round(dx / cellWidth) : 0;
  const rows = rowHeight > 0 ? Math.round(dy / rowHeight) : 0;
  return columns + rows * 7;
}

/** Той самий зсув у формі, яку чекає `useEventDrag` */
export function monthSnap(cellWidth: number, rowHeight: number) {
  return (dx: number, dy: number): DragDelta => ({
    minutes: 0,
    dayShift: monthDayShift(dx, dy, cellWidth, rowHeight),
  });
}

/**
 * Куди саме показує курсор. Точка → глобальний індекс дня в сітці місяця.
 *
 * Hit-test, а не арифметика: тижневі ряди в місяці МОЖУТЬ бути різної висоти
 * (в одному дві доріжки смуг, у сусідньому жодної), і «пікселі поділити на
 * висоту ряду» дало б промах на цілий тиждень. Ряд знаходиться через
 * `closest` — він предок і клітинок, і плиток, тож працює, під чим би не
 * стояв курсор. Колонка всередині ряду геометрична: сім рівних треків.
 *
 * `null` — курсор поза сіткою; тоді споживач лишає геометричний фолбек
 * (`monthDayShift`), бо промах у чистому полі нікому не шкодить.
 */
export function dayIndexAtPoint(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest<HTMLElement>('[data-week-index]');
  if (!row) {
    return null;
  }
  const weekIndex = Number.parseInt(row.dataset.weekIndex ?? '', 10);
  if (Number.isNaN(weekIndex)) {
    return null;
  }
  const rect = row.getBoundingClientRect();
  const column = Math.floor(((x - rect.left) / rect.width) * 7);
  return weekIndex * 7 + Math.min(Math.max(column, 0), 6);
}

/** Висота плитки з часом у клітинці місяця (px): рядок 20px + gap 2px */
const MONTH_CHIP_PX = 22;

/** Мінімум і максимум слотів — навіть у дуже високому рядку список не безмежний */
const MIN_MONTH_SLOTS = 1;
const MAX_MONTH_SLOTS = 6;

/**
 * Скільки плиток з часом влазить у клітинку — від ФАКТИЧНОЇ висоти ряду, а не
 * від константи (ідея з calendarcn `getMonthSlotCount`).
 *
 * Було: жорсткі три плитки, тож на великому екрані половина клітинки стояла
 * порожньою під написом «+2 more», а на низькому вміст вилазив за межу.
 * Останній слот віддається під сам напис «+N more», якщо приховане існує —
 * інакше він або перекривав би плитку, або вимагав ще одного ряду.
 */
export function monthSlotCount(
  rowHeight: number,
  headRowPx: number,
  spanRows: number,
  spanRowPx: number,
): number {
  const free = rowHeight - headRowPx - spanRows * spanRowPx;
  const slots = Math.floor(free / MONTH_CHIP_PX);
  return Math.min(Math.max(slots, MIN_MONTH_SLOTS), MAX_MONTH_SLOTS);
}
