import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';
import { TimeZoneSchema } from '../time/time.schema';

/**
 * Календар і події користувача (docs/calendar.md).
 *
 * Ім'я `CalendarEvent`, а не `Event`: слово `event` у цьому репозиторії зайняте
 * асинхронними повідомленнями (`defineEvent`), socket-подіями (`REALTIME_EVENTS`)
 * і журналом (`activities`) — доменна сутність під тим самим іменем зробила б
 * нечитабельним кожне друге речення (§2 доку).
 */

/** Тип події: несе колір та іконку, поведінки НЕ змінює */
export const CalendarEventKindSchema = z.enum([
  'MEETING',
  'CALL',
  'DEADLINE',
  'OUT_OF_OFFICE',
  'OTHER',
]);

/**
 * STATUS із RFC 5545. `CANCELLED` замінює soft delete: учасник мусить побачити
 * «скасовано», а не «зникло» — тому скасування це подія (окремий ендпоінт),
 * а `DELETE` лишається виправленням щойно зробленої помилки.
 */
export const CalendarEventStatusSchema = z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']);

/**
 * CLASS із RFC 5545. У V1 подію бачать ЛИШЕ організатор і учасники, тому поле
 * поки нічого не приховує — воно вмикається в командному перегляді (CAL-3), де
 * сторонній бачить чужий день. Заведене з першого дня свідомо: додати колонку
 * потім дешево, а переконати клієнтів, що вони вже пів року показували назви
 * приватних зустрічей, — ні.
 */
export const CalendarEventVisibilitySchema = z.enum(['DEFAULT', 'PRIVATE']);

export const CalendarAttendeeRoleSchema = z.enum(['REQUIRED', 'OPTIONAL']);

/** PARTSTAT із RFC 5545 — рівно ті самі чотири значення */
export const CalendarAttendeeResponseSchema = z.enum([
  'NEEDS_ACTION',
  'ACCEPTED',
  'DECLINED',
  'TENTATIVE',
]);

/** Порожній рядок із форми = «значення немає» (та сама нормалізація, що в customers) */
const emptyToNull = (value: string): string | null => (value === '' ? null : value);

function optionalText(
  max: number,
): z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodString, z.ZodTransform<string | null, string>>>> {
  return z.string().trim().max(max).transform(emptyToNull).nullable().optional();
}

/**
 * Нагадування — ХВИЛИНИ ДО початку, а не абсолютний час: подію переносять, і
 * абсолютний момент довелося б перераховувати на кожен зсув (а частину —
 * забути). 0 = «у момент початку», максимум — 4 тижні.
 */
export const MAX_REMINDER_MINUTES_BEFORE = 40_320;

export const CalendarReminderInputSchema = z.object({
  minutesBefore: z.number().int().min(0).max(MAX_REMINDER_MINUTES_BEFORE),
  /** Ключ (type, channel) закладений під email; у V1 живий рівно `in_app` */
  channel: z.literal('in_app').default('in_app').optional(),
});

export const CalendarAttendeeInputSchema = z.object({
  userId: z.uuid(),
  role: CalendarAttendeeRoleSchema.default('REQUIRED').optional(),
});

/**
 * Створення. `startsAt`/`endsAt` — ISO-інстанти (wire-формат усіх дат у
 * контрактах), `timeZone` — зона, В ЯКІЙ час задали.
 *
 * Перевірку `endsAt > startsAt` робить СЕРВІС, а не `.refine()` тут: refine
 * повернув би `ZodType` замість `ZodObject`, і `UpdateCalendarEventSchema`
 * не змогла б узяти `.partial()` (та сама причина, через яку пара
 * phone/phoneCountry узгоджується в сервісі, а не крос-полевим refine).
 */
export const CreateCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  location: optionalText(200),
  kind: CalendarEventKindSchema.default('MEETING').optional(),
  /**
   * `TENTATIVE` при створенні легальний («поки під питанням»), а от `CANCELLED`
   * скасовує подію — і це окремий ендпоінт, бо про скасування треба сповістити
   * учасників. Тому тут звужено до двох значень.
   */
  status: z.enum(['CONFIRMED', 'TENTATIVE']).default('CONFIRMED').optional(),
  visibility: CalendarEventVisibilitySchema.default('DEFAULT').optional(),
  /** TRANSP: чи рахувати подію зайнятістю при перевірці накладань */
  busy: z.boolean().optional(),
  startsAt: z.iso.datetime(),
  /** ЕКСКЛЮЗИВНИЙ кінець: подія 10:00–11:00 — це пів-інтервал [10:00, 11:00) */
  endsAt: z.iso.datetime(),
  /** Не передали → зона юзера, а за її відсутності — зона організації */
  timeZone: TimeZoneSchema.optional(),
  /**
   * All-day. Час у `startsAt`/`endsAt` при цьому ІГНОРУЄТЬСЯ: сервер нормалізує
   * межі до опівночі в `timeZone` події, а клієнт рендерить дату в зоні ПОДІЇ,
   * а не глядача (§6.2 доку) — інакше день народження 6-го числа виглядав би
   * як 5-те для колеги з іншого боку океану.
   */
  allDay: z.boolean().optional(),
  /** Контекст CRM: подія потрапляє у стрічку кастомера і в блок на його картці */
  customerId: z.uuid().nullable().optional(),
  /**
   * Учасники одним запитом зі створенням: інакше кожна нова зустріч — це
   * POST + PUT, а між ними подія існує без тих, кого скликали.
   */
  attendees: z.array(CalendarAttendeeInputSchema).max(100).optional(),
  /** МОЇ нагадування. Не передали → дефолт із налаштувань організації */
  reminders: z.array(CalendarReminderInputSchema).max(5).optional(),
});

/**
 * `status` тут немає: скасування і відновлення — події з окремими ендпоінтами
 * (як статус кастомера). `attendees` і `reminders` — теж: у них власні
 * під-ресурси, бо склад учасників треба ДИФАТИ (не спамити запрошеннями тих,
 * хто вже в списку), а нагадування персональні — учасник міняє свої, не чужі.
 */
export const UpdateCalendarEventSchema = CreateCalendarEventSchema.omit({
  status: true,
  attendees: true,
  reminders: true,
})
  .partial()
  // `.partial()` НЕ знімає `.default()` — Zod застосовує дефолт до відсутнього
  // ключа й повертає його як значення. Через це PATCH, що ніс лише час
  // (перетягування!), приходив у сервіс із `kind: 'MEETING'` і
  // `visibility: 'DEFAULT'` — тип події скидався, а ПРИВАТНА подія ставала
  // видимою для колег. Тому в UPDATE-схемі ці поля перевизначені без дефолтів:
  // «не передали» тут мусить означати «не чіпай», а не «постав звичайне»
  // (спіймано 2026-09-08, docs/calendar.md §18.17)
  .extend({
    kind: CalendarEventKindSchema.optional(),
    visibility: CalendarEventVisibilitySchema.optional(),
  });

/** Скасування/відновлення — подія, яку читають у журналі, а не редагування поля */
export const SetCalendarEventStatusSchema = z.object({
  status: CalendarEventStatusSchema,
});

/** Повний склад учасників = документ: сервер сам порівняє його з поточним */
export const SetCalendarAttendeesSchema = z.object({
  attendees: z.array(CalendarAttendeeInputSchema).max(100),
});

/** Моя відповідь. Мого id у шляху немає — суб'єкт із токена (доктрина /account) */
export const SetCalendarRsvpSchema = z.object({
  response: CalendarAttendeeResponseSchema,
  comment: optionalText(500),
});

/** Повний набір МОЇХ нагадувань на подію, ідемпотентно */
export const SetCalendarRemindersSchema = z.object({
  reminders: z.array(CalendarReminderInputSchema).max(5),
});

// ---------------------------------------------------------------- читання

/** Ліміт довжини вікна: два місячні перегляди поспіль. Перевіряє сервіс → 400 */
export const MAX_CALENDAR_WINDOW_DAYS = 62;

/**
 * Читання ЗАВЖДИ вікном (`from`/`to`), а не сторінками: «сторінка 7 календаря»
 * не означає нічого, а `total` за вікном ніхто не читає. Пагінація лишається
 * тільки в agenda — там це справді нескінченний фід «що далі».
 */
export const CalendarEventQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  /**
   * Дефолт «мого календаря» — події, де я організатор АБО учасник. Події моїх
   * кастомерів свідомо не додаються: менеджер із 200 клієнтами побачив би чужі
   * дзвінки у своєму тижні. Для них є `customerId`.
   *
   * Wire-формат — рядок 'true'/'false', як усі boolean-фільтри в цьому API.
   */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ownerId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  kind: CalendarEventKindSchema.optional(),
  /** Скасовані за замовчуванням приховані — як архівні кастомери в гріді */
  includeCancelled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** Agenda — курсорний фід «далі»: той самий контракт, що в activities */
export const CalendarAgendaQuerySchema = CursorQuerySchema.extend({
  /** Початок відліку; не передали → «від зараз» */
  from: z.iso.datetime().optional(),
  customerId: z.uuid().optional(),
  kind: CalendarEventKindSchema.optional(),
});

// ---------------------------------------------------------------- відповіді

/** Снапшот людини у відповіді: список малює ім'я без другого запиту */
export const CalendarUserRefSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
});

/**
 * Учасник. Юзер — ВКЛАДЕНИЙ обʼєкт, а не розсипані `userId`/`email`/`name`.
 *
 * Спершу тут була плоска форма Google (`attendees[]: {email, displayName,
 * responseStatus}`), і сама по собі вона захищається: рядок участі — самостійна
 * сутність зі своїм станом. Але в цьому репозиторії вже є конвенція, і вона
 * розрізняє два випадки:
 *
 * - **живий юзер із FK** → вкладений `{id, email, name}` (`customer.owner`,
 *   `calendarEvent.owner` — той самий `CalendarUserRefSchema`);
 * - **снапшот без FK** → плоска трійка `actorType`/`actorId`/`actorLabel`
 *   (`activities`, `notifications`), бо юзера могли видалити, а актором буває
 *   ще й `system`.
 *
 * Учасник — перший випадок (композитний FK із каскадом), тож форма мусить бути
 * вкладена: інакше в одній відповіді те саме поняття має дві різні форми, а
 * кожне нове поле юзера доводиться дописувати префіксом (`userAvatarUrl`…).
 *
 * `userId` окремо НЕ дублюється — на відміну від `customer.ownerId`, який
 * лишається полем, бо ним фільтрує грід. Тут клієнту достатньо `user.id`.
 *
 * Три поля нижче — стан САМОГО рядка участі, не юзера: юзер відповідає на «хто»,
 * вони — на «як він відреагував».
 */
export const CalendarAttendeeResponseItemSchema = z.object({
  /** id рядка участі, а не юзера */
  id: z.uuid(),
  user: CalendarUserRefSchema,
  role: CalendarAttendeeRoleSchema,
  /** PARTSTAT із RFC 5545 */
  response: CalendarAttendeeResponseSchema,
  /**
   * Коли відповів; `null`, доки `NEEDS_ACTION`. Організатора цікавить не лише
   * «хто не відповів», а й «скільки вже» — і цей момент неможливо добрати заднім
   * числом, тому пишеться з першого дня.
   */
  respondedAt: z.iso.datetime().nullable(),
  /** Необовʼязкова примітка до відповіді («буду, але на 15 хв пізніше») */
  comment: z.string().nullable(),
});

export const CalendarReminderResponseSchema = z.object({
  id: z.uuid(),
  minutesBefore: z.number().int().nonnegative(),
  channel: z.string(),
});

export const CalendarEventResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  kind: CalendarEventKindSchema,
  status: CalendarEventStatusSchema,
  visibility: CalendarEventVisibilitySchema,
  busy: z.boolean(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.string(),
  allDay: z.boolean(),
  /**
   * Межі КОНКРЕТНОГО входження. У V1 завжди дорівнюють `startsAt`/`endsAt`, і це
   * не зайві поля, а рішення §7 доку: з появою повторень (CAL-4) один рядок
   * почне давати N елементів, і без цієї пари довелося б міняти контракт і
   * переписувати клієнта. Ключ елемента на фронті — `${id}:${occurrenceStart}`.
   */
  occurrenceStart: z.iso.datetime(),
  occurrenceEnd: z.iso.datetime(),
  /** Майстер серії; у V1 завжди null (див. вище) */
  recurringEventId: z.uuid().nullable(),
  /** null — організатора видалили разом із юзером; тоді подію редагує ADMIN */
  ownerId: z.uuid().nullable(),
  owner: CalendarUserRefSchema.nullable(),
  customerId: z.uuid().nullable(),
  customer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  attendees: z.array(CalendarAttendeeResponseItemSchema),
  /** МОЇ нагадування на цю подію — у чужі не заглядаємо */
  reminders: z.array(CalendarReminderResponseSchema),
  /** Моя відповідь; null — я не учасник (напр. дивлюсь як організатор) */
  myResponse: CalendarAttendeeResponseSchema.nullable(),
  isOrganizer: z.boolean(),
  /**
   * Чи можу я редагувати. Рахує сервер: правила доступу (§9.8) не мають
   * дублюватись на фронті — розійшовшись, вони дадуть кнопку, яка завжди 403.
   */
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * Відповідь вікна. Без `total`/`page`/`totalPages`: у вікна їх немає за
 * визначенням. `window` повертається назад свідомо — клієнт звіряє, що дивиться
 * саме на те, що просив (після нормалізації межі можуть відрізнятись).
 */
export const CalendarEventListResponseSchema = z.object({
  items: z.array(CalendarEventResponseSchema),
  window: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
});

export const CalendarAgendaResponseSchema = cursorResponseSchema(CalendarEventResponseSchema);
