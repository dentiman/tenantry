import { z } from 'zod';
import { NotificationResponseSchema } from '../notification/notification.schema';

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
 * Room-и. Теж протокол, а не конфіг застосунку: імена формує і `apps/api` (гейтвей,
 * емісія), і `apps/worker` (headless-емітер сповіщень) — розійшовшись, вони тихо
 * перестали б доставляти.
 *
 * Префікс тенанта обовʼязковий: `user:{userId}` без нього дав би одне ім'я room-у
 * різним тенантам, а adapter розносить broadcast ПО ІМЕНІ, не звіряючись із
 * tenant-контекстом. PII в іменах немає — room-и видно в трафіку адаптера.
 */
export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;
export const userRoom = (tenantId: string, userId: string): string =>
  `tenant:${tenantId}:user:${userId}`;

/**
 * AUTH-1: room однієї СЕСІЇ-пристрою. Потрібен рівно для однієї операції —
 * «завершити цю сесію» мусить порвати socket саме того пристрою, лишивши живими
 * інші вкладки того самого юзера. Через `userRoom` це нерозв'язне: він не
 * розрізняє пристрої за побудовою.
 *
 * `sid` — id рядка `auth_sessions`, він же claim у access-токені.
 */
export const sessionRoom = (tenantId: string, sid: string): string =>
  `tenant:${tenantId}:session:${sid}`;

/**
 * Ключі Redis Streams-адаптера. Теж протокол: `apps/api` і `apps/worker` мусять
 * писати В ОДИН стрім, інакше емісія з воркера просто нікуди не доїде — тихо,
 * без жодної помилки. Тому імена рахуються тут, а не складаються рядками на місці.
 */
export const REALTIME_DEFAULT_KEY_PREFIX = 'saas:rt';
export const realtimeStreamName = (keyPrefix: string): string => `${keyPrefix}:sio:stream`;
export const realtimeSessionKeyPrefix = (keyPrefix: string): string => `${keyPrefix}:sio:session:`;

/**
 * Імена подій із версією в суфіксі — та сама доктрина, що в messaging (`defineEvent`):
 * зміна форми payload-у = нове імʼя, а не тихо інша структура під старим.
 */
export const REALTIME_EVENTS = {
  presenceChanged: 'presence.changed.v1',
  authExpiring: 'auth.expiring.v1',
  authUpdate: 'auth.update.v1',
  resyncRequired: 'realtime.resync-required.v1',
  notificationCreated: 'notification.created.v1',
  notificationChanged: 'notification.changed.v1',
  calendarEventChanged: 'calendar.event-changed.v1',
  aiMessageDelta: 'ai.message-delta.v1',
  aiMessageCompleted: 'ai.message-completed.v1',
  aiConversationChanged: 'ai.conversation-changed.v1',
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
  /**
   * Лише для `status: 'offline'` — момент останньої ПІДТВЕРДЖЕНОЇ присутності
   * (RT-3). Потрібен тому, що `lastSeenAt` у вже завантаженому списку юзерів
   * застарілий на весь час від фетчу: без цього поля рядок у ту саму секунду,
   * коли юзер закрив вкладку, показав би «last seen 12 minutes ago».
   *
   * Свідомо НЕ `occurredAt`: для переходу зі sweeper-а подія публікується на
   * хвилину пізніше самого факту.
   *
   * Ім'я події лишається `.v1`, хоча доктрина вимагає версію на зміну форми
   * payload-у: її мета — щоб споживач не прочитав дані інакше, ніж їх записали,
   * а ДОДАВАННЯ опційного поля старий клієнт може лише проігнорувати.
   */
  lastSeenAt: z.iso.datetime().optional(),
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

// ---------------------------------------------------------------- notifications

/**
 * Нове сповіщення в особистий room отримувача.
 *
 * Везе ПОВНИЙ рядок, а не тільки id (уточнення до раннього начерку EDA §3.12):
 * джерелом правди лишається REST, тому правило «жоден стан не живе тільки в сокеті»
 * дотримане — `revision` дає resync при будь-якій втраті. А ходити в REST за вмістом,
 * який сервер уже тримає в руках, — зайвий roundtrip і мигання порожнього рядка.
 */
export const NotificationCreatedSchema = z.object({
  notification: NotificationResponseSchema,
  unreadCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});

/**
 * Зміна стану інбокса. Летить в УСІ вкладки й на всі пристрої юзера, включно з тим,
 * де дію зробили: прочитав на ноуті — бейдж згас на телефоні.
 */
export const NotificationChangedSchema = z.object({
  change: z.enum(['read', 'unread', 'archived', 'seen']),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ids'), ids: z.array(z.uuid()).min(1) }),
    // mark-all-read: перелік id був би на сотні рядків і нічого не додавав би
    z.object({ kind: z.literal('all') }),
  ]),
  unreadCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});

// ---------------------------------------------------------------- calendar

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

// ------------------------------------------------------------- ai assistant

/**
 * ПЕРШИЙ У ЦЬОМУ РЕПОЗИТОРІЇ випадок, коли socket-подія несе САМ ВМІСТ, а не сигнал
 * «перечитай» (docs/realtime.md § «Межа з event-driven шаром», правило 2). Це
 * свідомий виняток, і він тримається на двох страховках — копіювати патерн без них
 * не можна:
 *
 * 1. `chunkSeq` монотонний у межах ОДНІЄЇ відповіді. Дірка в нумерації означає, що
 *    дельту загублено, і клієнт іде за `GET /ai/conversation` — там лежить той самий
 *    текст із Postgres. Тобто втрата дельти сповільнює рендер, але нічого не втрачає.
 * 2. `chunkSeq === 0` для відповіді, у якій уже є текст, означає ПЕРЕЗАПУСК генерації
 *    (автоматичний ретрай після тимчасової відмови провайдера): клієнт викидає
 *    накопичене і починає спочатку, інакше дві спроби склеїлись би в одну відповідь.
 *
 * Джерелом правди лишається БД; сокет — лише прискорення.
 */
export const AiMessageDeltaSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /**
   * Номер спроби генерації, якій належить ця дельта (AI-0.1, design.md D1/D6).
   * Фенсинг-токен: дельта нижчої спроби за ту, що клієнт уже показує, — застаріла
   * і відкидається; вища спроба означає перезапуск. Це замінює стару ознаку
   * перезапуску `chunkSeq === 0` — вона сама по собі не відрізняла б перезапуск
   * від дельти застарілої спроби з тим самим номером кадру.
   */
  attempt: z.number().int().nonnegative(),
  chunkSeq: z.number().int().nonnegative(),
  /** Приріст тексту, а не весь текст: чанки конкатенуються в порядку `chunkSeq` */
  text: z.string(),
});

/**
 * Термінальний стан відповіді. `status` тут ніколи не `PENDING`/`STREAMING`.
 * Подія надходить ПІСЛЯ комміту рядка (after-commit хук), тому клієнт, який у
 * відповідь на неї перечитає стрічку, гарантовано побачить фінальний текст.
 */
export const AiMessageCompletedSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  status: z.enum(['COMPLETE', 'FAILED', 'CANCELLED']),
  errorCode: z.enum(['PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INTERNAL']).nullable(),
  occurredAt: z.iso.datetime(),
});

/**
 * Сигнал «розмова змінилась», без даних (AI-0.1, design.md D7). Єдина причина
 * її існування — інші вкладки того самого юзера: `ai.message-delta.v1` доходить
 * лише туди, де повідомлення вже в кеші, а перше питання ходу та `reset()`
 * жодної дельти не мають. Реакція клієнта — одне дедупліковане перечитування
 * стрічки; сам факт лишається джерелом правди, як і решта realtime (docs/realtime.md).
 */
export const AiConversationChangedSchema = z.object({
  // ai-1e: null для 'deleted' — «видалити мої розмови» прибирає ВСІ розмови юзера
  // одразу, тож жодна конкретна не є «тією, що змінилась»
  conversationId: z.uuid().nullable(),
  reason: z.enum(['turn-created', 'reply-closed', 'reset', 'deleted']),
  occurredAt: z.iso.datetime(),
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
