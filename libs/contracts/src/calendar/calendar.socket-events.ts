import { z } from 'zod';
import { defineSocketEvent } from '../realtime/socket-event';

/**
 * Зміна події календаря (docs/calendar.md §9.3). Летить в особисті room-и ВСІХ
 * учасників, включно з тим, хто дію зробив: у нього можуть бути інші вкладки, і
 * правило «стан не живе тільки в сокеті» вимагає, щоб усі вони зійшлися на тому
 * самому REST-джерелі.
 *
 * Чотири поля, а НЕ повний рядок події (на відміну від `notification.created.v1`):
 * клієнту достатньо вирішити, чи потрапляє зміна у ВІДКРИТЕ вікно, а саме вікно
 * він однак перечитує цілком — зсув однієї події міняє розкладку сусідніх.
 * Плюс так у сокет не їде ні назва приватної події, ні склад учасників.
 */
export const CalendarEventChangeSchema = z.enum(['created', 'updated', 'deleted']);

export const CalendarEventChangedSchema = z.object({
  eventId: z.uuid(),
  change: CalendarEventChangeSchema,
  /**
   * Межі ПІСЛЯ зміни (для `deleted` — ті, що були): по них клієнт розуміє, чи
   * перетинає подія його вікно. Для перенесеної події старе вікно теж мусить
   * перемалюватись, тому сервер шле дві дельти — див. §9.3.
   */
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
});

export type CalendarEventChanged = z.infer<typeof CalendarEventChangedSchema>;

/** Події сокета календаря (docs/calendar.md §9.3); збирає root `socket-events.ts` */
export const CALENDAR_SOCKET_EVENTS = {
  calendarEventChanged: defineSocketEvent('calendar.event-changed.v1', CalendarEventChangedSchema),
};
