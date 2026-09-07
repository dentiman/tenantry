import type { QueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type CalendarEventChanged } from '@saas-skeleton/contracts';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindOneQueryKey,
  getCalendarFindWindowQueryKey,
} from '../api/generated/api';
import { getSocket } from './socket';

/**
 * Міст socket → TanStack Query для календаря (docs/calendar.md §9.3). Той самий
 * принцип, що в presence і в інбоксі: server state живе в кеші запитів, socket
 * його ІНВАЛІДУЄ, а не стає другим джерелом правди.
 *
 * Відмінність від інбокса: дельта не несе рядка події і нічого не патчить. Вона
 * відповідає на одне питання — «чи потрапляє зміна у ВІДКРИТЕ вікно»; якщо так,
 * вікно перечитується цілком, бо зсув однієї події міняє розкладку сусідніх
 * (накладання, колонки), і патчити один елемент означало б вгадувати решту.
 */
export function initCalendarSync(queryClient: QueryClient): void {
  const socket = getSocket();

  /**
   * Ключ вікна — `[url, params]` від orval, тобто межі періоду лежать у другому
   * елементі. Перебираємо ЖИВІ ключі кеша і чіпаємо тільки ті вікна, які справді
   * перетинаються зі зміненою подією: інакше кожна чужа зустріч у сусідньому
   * місяці перемальовувала б поточний тиждень.
   */
  const invalidateAffectedWindows = (payload: CalendarEventChanged): void => {
    const changedStart = new Date(payload.startsAt).getTime();
    const changedEnd = new Date(payload.endsAt).getTime();

    void queryClient.invalidateQueries({
      queryKey: getCalendarFindWindowQueryKey(),
      predicate: (query) => {
        const params = query.queryKey[1] as { from?: string; to?: string } | undefined;
        if (!params?.from || !params.to) {
          // Ключ без параметрів (напр. частковий) — перечитуємо, це дешевше за
          // ризик показувати застаріле
          return true;
        }
        const from = new Date(params.from).getTime();
        const to = new Date(params.to).getTime();
        // Той самий пів-відкритий перетин, що на сервері: строгі нерівності
        return changedStart < to && changedEnd > from;
      },
    });
  };

  socket.on(REALTIME_EVENTS.calendarEventChanged, (payload: CalendarEventChanged) => {
    invalidateAffectedWindows(payload);
    // Agenda — фід «що далі», межі в неї немає, тому інвалідуємо завжди
    void queryClient.invalidateQueries({ queryKey: getCalendarAgendaQueryKey() });
    // Відкрита картка події (deep link або панель) мусить показати новий час
    void queryClient.invalidateQueries({
      queryKey: getCalendarFindOneQueryKey(payload.eventId),
    });
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети сесії. Якщо ні —
    // невідомо, що сталось за час розриву, і дельтам довіряти не можна
    if (!socket.recovered) {
      void queryClient.invalidateQueries({ queryKey: getCalendarFindWindowQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getCalendarAgendaQueryKey() });
    }
  });
}
