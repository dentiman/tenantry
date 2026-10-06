import type { z } from 'zod';

/**
 * Подія server → client: імʼя з версією в суфіксі і схема payload-у. Та сама доктрина, що
 * в messaging (`defineEvent`): зміна форми payload-у = нове імʼя, а не тихо інша структура
 * під старим.
 *
 * Подію оголошує модуль, якому вона належить (`calendar/calendar.socket-events.ts`); модуль
 * realtime дає лише механізм і транспорт, а root `libs/contracts/src/socket-events.ts`
 * збирає всі події в типізований протокол (docs/modules.md §7.2).
 */
export interface SocketEventDef<N extends string = string, S extends z.ZodType = z.ZodType> {
  readonly name: N;
  readonly schema: S;
}

export function defineSocketEvent<const N extends string, S extends z.ZodType>(
  name: N,
  schema: S,
): SocketEventDef<N, S> {
  return { name, schema };
}

/** Карта `імʼя → (payload) => void` для `Server<…>` / `Socket<…>` Socket.IO */
export type ServerEventsOf<T extends Record<string, SocketEventDef>> = {
  [K in keyof T as T[K]['name']]: (payload: z.infer<T[K]['schema']>) => void;
};

/** `{ ключ: імʼя }` — щоб код писав `REALTIME_EVENTS.calendarEventChanged`, а не рядок */
export function socketEventNames<const T extends Record<string, SocketEventDef>>(
  events: T,
): { readonly [K in keyof T]: T[K]['name'] } {
  return Object.fromEntries(Object.entries(events).map(([key, event]) => [key, event.name])) as {
    readonly [K in keyof T]: T[K]['name'];
  };
}
