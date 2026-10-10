import { z } from 'zod';

/**
 * Подія client → server: імʼя з версією, схема payload-у і схема ДАНИХ ack-у. Інвертований
 * близнюк `defineSocketEvent` (server → client): та сама доктрина — зміна форми = нове
 * імʼя, а не тихо інша структура під старим.
 *
 * Подію оголошує модуль-власник (`chat/chat.client-events.ts`); модуль realtime дає лише
 * механізм (`ClientEventRegistry` в `apps/api/src/realtime/`): валідацію payload-у, ліміт
 * частоти, tenant-контекст і єдиний формат відповіді. Root `socket-events.ts` збирає всі
 * події в типізований протокол (docs/modules.md §7.2).
 */
export interface ClientSocketEventDef<
  N extends string = string,
  P extends z.ZodType = z.ZodType,
  A extends z.ZodType = z.ZodType,
> {
  readonly name: N;
  readonly payload: P;
  /** Схема `data` успішної відповіді; помилка ack-а однакова для всіх подій */
  readonly ack: A;
}

export function defineClientSocketEvent<
  const N extends string,
  P extends z.ZodType,
  A extends z.ZodType,
>(name: N, payload: P, ack: A): ClientSocketEventDef<N, P, A> {
  return { name, payload, ack };
}

/**
 * Закритий перелік причин відмови. Той самий принцип, що в `ApiError`: назовні машинний
 * код, англійський діагностичний текст лишається в лозі. `NOT_FOUND` — і для чужого, і
 * для неіснуючого обʼєкта: інша відповідь зробила б подію оракулом.
 */
export const ClientEventErrorCodeSchema = z.enum([
  'INVALID_PAYLOAD',
  'NOT_FOUND',
  'FORBIDDEN',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'INTERNAL',
]);

export type ClientEventErrorCode = z.infer<typeof ClientEventErrorCodeSchema>;

/** Єдина форма відповіді на будь-яку зареєстровану подію */
export type ClientEventAck<T> = { ok: true; data: T } | { ok: false; code: ClientEventErrorCode };

/** Карта `імʼя → (payload, ack) => void` для `Socket<…>` Socket.IO на обох кінцях */
export type ClientEventsOf<T extends Record<string, ClientSocketEventDef>> = {
  [K in keyof T as T[K]['name']]: (
    payload: z.input<T[K]['payload']>,
    ack: (result: ClientEventAck<z.infer<T[K]['ack']>>) => void,
  ) => void;
};

/** `{ ключ: імʼя }` — щоб код писав `CLIENT_EVENTS.chatSubscribe`, а не рядок */
export function clientSocketEventNames<const T extends Record<string, ClientSocketEventDef>>(
  events: T,
): { readonly [K in keyof T]: T[K]['name'] } {
  return Object.fromEntries(Object.entries(events).map(([key, event]) => [key, event.name])) as {
    readonly [K in keyof T]: T[K]['name'];
  };
}
