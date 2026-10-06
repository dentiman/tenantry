/**
 * Накладання нової/зміненої події на інші МОЇ події (CAL-2, F-08).
 *
 * **Попередження, а не заборона** (§15.1): «дві зустрічі в один час» — легальна
 * ситуація (одну з них людина саме збирається відхилити, друга опційна, третя —
 * нагадування «не забути»), тож клієнт лише показує, а сервер нічого не валідує.
 * Це й причина, чому перевірка ЖИВЕ НА ФРОНТІ: бекенд не має правила, яке міг би
 * порушити, а гонка «хтось створив конфлікт поки я редагував» тут нічого не
 * ламає — я побачу його при наступному відкритті.
 *
 * Чиста функція — той самий контракт, що `layoutOverlaps` і `resolveHotkey`.
 */

export interface ConflictEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  busy: boolean;
  status: string;
  myResponse: string | null;
}

export interface ConflictRange {
  startsAt: string;
  endsAt: string;
}

/**
 * Кого НЕ вважаємо конфліктом (і чому саме):
 * - **себе** — очевидно, але забути легко: рядок редагованої події приїжджає в
 *   тому самому вікні, і без `excludeId` кожне збереження часу показувало б
 *   «конфліктує сама з собою»;
 * - **скасовані** — подія лишається в списку (скасування ≠ видалення), але часу
 *   вона більше не займає;
 * - **`busy: false`** — це `TRANSP` із RFC 5545, тобто «показувати мене вільним»;
 *   такі події (нагадування «здати звіт») навмисно не блокують час;
 * - **all-day** — накриває всю добу і конфліктувала б із КОЖНОЮ подією дня;
 *   «відпустка» — контекст, а не зайнятий слот;
 * - **мій `DECLINED`** — я вже сказав, що не буду.
 */
export function findConflicts<T extends ConflictEvent>(
  range: ConflictRange,
  events: readonly T[],
  excludeId: string | null,
): T[] {
  const start = new Date(range.startsAt).getTime();
  const end = new Date(range.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }

  return events
    .filter((event) => {
      if (event.id === excludeId || event.allDay || !event.busy) {
        return false;
      }
      if (event.status === 'CANCELLED' || event.myResponse === 'DECLINED') {
        return false;
      }
      const otherStart = new Date(event.startsAt).getTime();
      const otherEnd = new Date(event.endsAt).getTime();
      // Інтервали ПІВ-ВІДКРИТІ, як і в моделі: подія 10:00–11:00 не конфліктує
      // з 11:00–12:00, хоча числа й дотикаються
      return otherStart < end && start < otherEnd;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}
