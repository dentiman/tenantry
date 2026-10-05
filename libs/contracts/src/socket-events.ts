import { AUTH_UPDATE_EVENT, PLATFORM_SOCKET_EVENTS } from './realtime/realtime.schema';
import { type ServerEventsOf, socketEventNames } from './realtime/socket-event';
import { CALENDAR_SOCKET_EVENTS } from './calendar/calendar.socket-events';
import { AI_SOCKET_EVENTS } from './ai/ai.socket-events';

/**
 * Composition root протоколу сокета (docs/module-registries.md R2): усі події server → client
 * в одному переліку — огляд протоколу лишається одним місцем, а схеми живуть у модулях-
 * власниках. Прибираючи фічу з форку, прибери її рядок тут.
 */
export const SERVER_SOCKET_EVENTS = {
  ...PLATFORM_SOCKET_EVENTS,
  ...CALENDAR_SOCKET_EVENTS,
  ...AI_SOCKET_EVENTS,
};

/** Імена подій за ключем — `REALTIME_EVENTS.calendarEventChanged` замість рядка */
export const REALTIME_EVENTS = {
  ...socketEventNames(SERVER_SOCKET_EVENTS),
  authUpdate: AUTH_UPDATE_EVENT,
} as const;

/**
 * Карта подій для `Server<...>` / `Socket<...>` на обох кінцях. Це і є «типізований
 * протокол»: додати подію на сервері й забути про клієнта не можна — не збереться.
 */
export type ServerToClientEvents = ServerEventsOf<typeof SERVER_SOCKET_EVENTS>;
