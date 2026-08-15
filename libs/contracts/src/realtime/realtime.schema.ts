import { z } from 'zod';

/**
 * Контракти realtime-шару (docs/realtime.md). Тут — і REST-схема snapshot-у, і схеми
 * socket-подій: це один протокол, розрізаний на два транспорти (snapshot по HTTP,
 * delta по WebSocket), тому жити вони мусять поруч.
 *
 * Правило те саме, що для HTTP-контрактів: КОЖЕН client → server payload валідується
 * рантаймом на сервері. `AllExceptionsFilter` — HTTP-фільтр, WebSocket-події він не
 * охоплює, тому socket має власний нормалізований envelope помилки (нижче).
 */

/** Engine path Socket.IO і namespace — константи протоколу, а не конфіг */
export const REALTIME_PATH = '/socket.io';
export const TENANT_NAMESPACE = '/tenant';

/**
 * Імена подій із версією в суфіксі — та сама доктрина, що в messaging (`defineEvent`):
 * зміна форми payload-у = нове імʼя, а не тихо інша структура під старим.
 */
export const REALTIME_EVENTS = {
  presenceChanged: 'presence.changed.v1',
  authExpiring: 'auth.expiring.v1',
  authUpdate: 'auth.update.v1',
  resyncRequired: 'realtime.resync-required.v1',
} as const;

// ---------------------------------------------------------------- presence

export const PresenceStatusSchema = z.enum(['online', 'offline']);

/**
 * Delta присутності. `revision` — лічильник ПЕРЕХОДІВ у межах тенанта (0→1 і 1→0),
 * не кількість конектів: друга вкладка того самого юзера присутності не змінює,
 * отже й ревізію не рухає.
 */
export const PresenceChangedSchema = z.object({
  userId: z.uuid(),
  status: PresenceStatusSchema,
  revision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});

/**
 * Snapshot — `GET /api/presence`. Віддає ТІЛЬКИ id: жодного email/імені, бо presence
 * читають усі юзери тенанта, а не лише ті, хто має право бачити профілі.
 */
export const PresenceSnapshotSchema = z.object({
  onlineUserIds: z.array(z.uuid()),
  revision: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});

// ---------------------------------------------------------------- auth cycle

/**
 * Сервер попереджає про близький `exp` access-токена. Socket живе годинами, токен —
 * 15 хвилин: без цього циклу зʼєднання довелося б рвати на кожному протуханні.
 */
export const AuthExpiringSchema = z.object({
  expiresAt: z.iso.datetime(),
});

export const AuthUpdateSchema = z.object({
  accessToken: z.string().min(1),
});

/**
 * Ack на `auth.update.v1`. Свідомо не «мовчазний успіх»: клієнт мусить знати,
 * що новий дедлайн прийнято, інакше він не відрізнить «оновив» від «сервер проігнорував».
 */
export const AuthUpdateResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted'), expiresAt: z.iso.datetime() }),
  z.object({ status: z.literal('rejected'), code: z.string() }),
]);

// ---------------------------------------------------------------- resync / errors

export const ResyncReasonSchema = z.enum([
  'recovery-failed', // Socket.IO connection state recovery не спрацювало
  'revision-gap', // сервер побачив, що клієнт відстав більше ніж на одну ревізію
  'broker-degraded', // Valkey був недоступний — стан міг розʼїхатись
]);

export const ResyncRequiredSchema = z.object({
  reason: ResyncReasonSchema,
  occurredAt: z.iso.datetime(),
});

/**
 * Закритий перелік причин відмови — рівно та сама доктрина, що `ApiError.code`:
 * код машинний і стабільний, текст — англійська діагностика для логів, юзеру його
 * не показують (рендерить фронт через i18next).
 */
export const RealtimeErrorCodeSchema = z.enum([
  'UNAUTHENTICATED', // немає/невалідний токен у handshake
  'TOKEN_EXPIRED', // exp минув і клієнт не прислав auth.update.v1
  'ACCOUNT_INACTIVE', // user.isActive або tenant.isActive = false
  'ORIGIN_NOT_ALLOWED', // Origin поза REALTIME_ALLOWED_ORIGINS
  'IDENTITY_CHANGED', // новий токен належить іншому sub/tenantId/role
  'INVALID_PAYLOAD', // client → server payload не пройшов Zod
  'INTERNAL',
]);

export const RealtimeErrorSchema = z.object({
  code: RealtimeErrorCodeSchema,
  message: z.string(),
});
