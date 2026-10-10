import { AUTH_UPDATE_EVENT, PLATFORM_SOCKET_EVENTS } from './realtime/realtime.schema';
import { type ServerEventsOf, socketEventNames } from './realtime/socket-event';
import {
  type ClientEventsOf,
  clientSocketEventNames,
} from './realtime/client-socket-event';
import type { PlatformClientToServerEvents } from './realtime/realtime.types';
import { CALENDAR_SOCKET_EVENTS } from './calendar/calendar.socket-events';
import { AI_SOCKET_EVENTS } from './ai/ai.socket-events';
import { CHAT_SOCKET_EVENTS } from './chat/chat.socket-events';
import { CHAT_CLIENT_SOCKET_EVENTS } from './chat/chat.client-events';

/**
 * Composition root протоколу сокета (docs/modules.md §7.2): усі події server → client
 * в одному переліку — огляд протоколу лишається одним місцем, а схеми живуть у модулях-
 * власниках. Прибираючи фічу з форку, прибери її рядок тут.
 */
export const SERVER_SOCKET_EVENTS = {
  ...PLATFORM_SOCKET_EVENTS,
  ...CALENDAR_SOCKET_EVENTS,
  ...AI_SOCKET_EVENTS,
  ...CHAT_SOCKET_EVENTS,
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

/**
 * Те саме для client → server (docs/modules.md §7.2): події, які фічі реєструють у
 * `ClientEventRegistry`. Платформна `auth.update.v1` сюди не входить — вона лишається
 * `@SubscribeMessage` гейтвея, бо змінює `socket.data` і тримає таймери.
 */
export const CLIENT_SOCKET_EVENTS = {
  ...CHAT_CLIENT_SOCKET_EVENTS,
};

/** Імена зареєстрованих подій за ключем — `CLIENT_EVENTS.chatSubscribe` замість рядка */
export const CLIENT_EVENTS = clientSocketEventNames(CLIENT_SOCKET_EVENTS);

/** Повний протокол client → server: платформні події + зареєстровані модулями */
export type ClientToServerEvents = PlatformClientToServerEvents &
  ClientEventsOf<typeof CLIENT_SOCKET_EVENTS>;
