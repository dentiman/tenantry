/**
 * Розкладка накладань у колонці дня.
 *
 * Чиста функція — і єдине місце календаря, яке справді просить unit-тест
 * (docs/calendar.md §13): алгоритм легко зламати рефакторингом, а помітно це
 * лише оком на конкретній комбінації подій.
 *
 * Алгоритм класичний: події групуються в КЛАСТЕРИ (ланцюжки, що перетинаються
 * хоч через сусіда), і всередині кластера кожна отримує першу вільну колонку.
 * Ширина = 1 / кількість колонок кластера, тому дві паралельні зустрічі
 * діляться навпіл, а не накривають одна одну.
 */

export interface OverlapInput {
  id: string;
  /** Хвилини від початку доби; кінець ЕКСКЛЮЗИВНИЙ, як і в самій моделі */
  startMinutes: number;
  endMinutes: number;
}

export interface OverlapSlot {
  column: number;
  columns: number;
}

/** Мінімальна візуальна довжина: 15-хвилинна подія має лишатись клікабельною */
const MIN_VISUAL_MINUTES = 15;

export function layoutOverlaps(items: readonly OverlapInput[]): Map<string, OverlapSlot> {
  const result = new Map<string, OverlapSlot>();
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes,
  );

  let cluster: { id: string; end: number; column: number }[] = [];
  let clusterEnd = -1;
  // Кінець кожної колонки в поточному кластері — по ньому шукається вільна
  let columnEnds: number[] = [];

  const flush = (): void => {
    const columns = columnEnds.length;
    for (const item of cluster) {
      result.set(item.id, { column: item.column, columns });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    const end = Math.max(item.endMinutes, item.startMinutes + MIN_VISUAL_MINUTES);
    // Кластер закінчився: нова подія не перетинає НІ ОДНУ з попередніх
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) {
      flush();
    }
    const free = columnEnds.findIndex((columnEnd) => columnEnd <= item.startMinutes);
    const column = free === -1 ? columnEnds.length : free;
    columnEnds[column] = end;
    cluster.push({ id: item.id, end, column });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return result;
}

/** Геометрія плитки у відсотках — те, що піде в inline-стилі */
export function slotStyle(
  item: OverlapInput,
  slot: OverlapSlot,
  minutesInDay: number,
): { top: string; height: string; left: string; width: string } {
  const end = Math.max(item.endMinutes, item.startMinutes + MIN_VISUAL_MINUTES);
  const width = 100 / slot.columns;
  return {
    top: `${String((item.startMinutes / minutesInDay) * 100)}%`,
    height: `${String(((end - item.startMinutes) / minutesInDay) * 100)}%`,
    left: `${String(slot.column * width)}%`,
    // Хвостик справа: сусідні плитки не мають злипатись у суцільну смугу
    width: `calc(${String(width)}% - 2px)`,
  };
}
