import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';

/**
 * Референс на сутність усередині payload: id — для майбутнього лінка на сторінку,
 * label — СНАПШОТ назви на момент події (сутність можуть перейменувати/видалити,
 * фід рендериться без join-ів на живі таблиці).
 */
export const EntityRefSchema = z.object({
  kind: z.string().min(1),
  id: z.uuid(),
  label: z.string(),
});

/**
 * Семантика зв'язку події з сутністю. NULL, коли неоднозначності немає (один лінк).
 * Словник валідує ця схема, а не колонка БД — нові ролі без міграції.
 */
export const ActivityLinkRoleSchema = z.enum(['subject', 'target', 'source', 'context']);
export type ActivityLinkRole = z.infer<typeof ActivityLinkRoleSchema>;

/** Закритий перелік типів — єдине місце додавання нового типу події */
export const ACTIVITY_TYPES = [
  'user.created',
  // Зміна пароля і вмикання/вимикання — три ОКРЕМІ типи, а не один
  // 'user.updated' із діффом: журнал читають люди, і «хто вимкнув доступ»
  // мусить фільтруватися одним type, не розбором payload-у.
  // Пароль у payload не потрапляє НІКОЛИ — ні новий, ні хеш, ні його довжина
  'user.password_changed',
  // Self-service «вийти на всіх пристроях». Окремий тип, а не 'user.password_changed':
  // відкликання сесій буває і без зміни пароля, і читач журналу має бачити різницю
  'user.sessions_revoked',
  'user.enabled',
  'user.disabled',
  'email.sent',
  // --- Кастомери (docs/customers.md §9). Окремі типи замість одного
  // 'customer.updated' із діффом — та сама доктрина, що в юзерах: журнал читають
  // люди, і «хто заархівував клієнта» мусить фільтруватися по type.
  // Редагування другорядних полів у журнал не потрапляє взагалі
  'customer.created',
  'customer.archived',
  'customer.restored',
  'customer.owner_changed',
  'customer.deleted',
  // --- Налаштування організації (docs/settings.md). Зміна стосується ВСІХ, а не
  // автора, тому за нею приходять питати «хто це зробив». Зсув нумерації —
  // окремий тип і з числом у payload: дія незворотна, аудиту потрібне значення
  'settings.updated',
  'settings.numbering_shifted',
  // --- Календар (docs/calendar.md §9.1). Знову окремі типи, а не один
  // 'calendar_event.updated': «хто пересунув зустріч» питають найчастіше, і це
  // мусить фільтруватися по type. Редагування назви чи опису в журнал НЕ йде —
  // інакше фід кастомера потоне в шумі
  'calendar_event.created',
  'calendar_event.rescheduled',
  'calendar_event.cancelled',
  'calendar_event.restored',
  'calendar_event.deleted',
  'calendar_event.attendee_added',
  'calendar_event.attendee_removed',
  'calendar_event.rsvp_changed',
] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * Payload-схема ПО ТИПУ: recorder валідує на записі (fail fast — невалідний payload
 * не потрапить в append-only таблицю), фронт знає форму для рендеру.
 */
export const ACTIVITY_PAYLOAD_SCHEMAS = {
  'user.created': z.object({
    user: EntityRefSchema, // kind: 'user'
  }),
  'user.password_changed': z.object({
    user: EntityRefSchema,
  }),
  'user.sessions_revoked': z.object({
    user: EntityRefSchema,
    // Скільки refresh-сесій вибито. Число, а не список: ідентичності пристрою в моделі
    // немає (рядок токена живе до найближчої ротації), і перелічувати нічого
    sessionCount: z.number().int().nonnegative(),
  }),
  'user.enabled': z.object({
    user: EntityRefSchema,
  }),
  'user.disabled': z.object({
    user: EntityRefSchema,
  }),
  'customer.created': z.object({
    customer: EntityRefSchema, // kind: 'customer'
  }),
  'customer.archived': z.object({
    customer: EntityRefSchema,
  }),
  'customer.restored': z.object({
    customer: EntityRefSchema,
    status: z.enum(['ACTIVE', 'INACTIVE']), // куди саме повернули з архіву
  }),
  'customer.owner_changed': z.object({
    customer: EntityRefSchema,
    // null з обох боків легальний: «нічий» — робочий стан, а не помилка
    previousOwner: EntityRefSchema.nullable(),
    owner: EntityRefSchema.nullable(),
  }),
  'customer.deleted': z.object({
    // Лінк лишається на неіснуючий id, і це нормально: журнал переживає сутність,
    // саме тому label — снапшот, а не join
    customer: EntityRefSchema,
  }),
  'settings.updated': z.object({
    section: z.string(), // 'general' | 'numbering' — секція редактора
  }),
  'settings.numbering_shifted': z.object({
    series: z.string(),
    nextNumber: z.number().int(),
  }),
  'calendar_event.created': z.object({
    event: EntityRefSchema, // kind: 'calendar_event'
    startsAt: z.iso.datetime(),
    // Снапшот контексту: подія могла бути привʼязана до кастомера, і фід
    // кастомера читає саме цей лінк
    customer: EntityRefSchema.nullable(),
  }),
  // Перенесення — окремий тип із ОБОМА моментами: «на коли перенесли» без
  // «з коли» не читається, а join на живий рядок фід робити не має права
  'calendar_event.rescheduled': z.object({
    event: EntityRefSchema,
    previousStartsAt: z.iso.datetime(),
    startsAt: z.iso.datetime(),
  }),
  'calendar_event.cancelled': z.object({
    event: EntityRefSchema,
  }),
  'calendar_event.restored': z.object({
    event: EntityRefSchema,
    status: z.enum(['CONFIRMED', 'TENTATIVE']), // куди саме повернули зі скасування
  }),
  'calendar_event.deleted': z.object({
    // Лінк лишається на неіснуючий id — журнал переживає сутність
    event: EntityRefSchema,
  }),
  'calendar_event.attendee_added': z.object({
    event: EntityRefSchema,
    attendee: EntityRefSchema, // kind: 'user'
  }),
  'calendar_event.attendee_removed': z.object({
    event: EntityRefSchema,
    attendee: EntityRefSchema,
  }),
  'calendar_event.rsvp_changed': z.object({
    event: EntityRefSchema,
    attendee: EntityRefSchema,
    response: z.enum(['NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']),
  }),
  'email.sent': z.object({
    template: z.string(), // 'welcome' — ключ у i18n фронта
    recipient: EntityRefSchema,
    email: z.email(), // снапшот адреси, на яку реально пішов лист
  }),
} as const satisfies Record<ActivityType, z.ZodType>;

/** Query: фід ЗАВЖДИ по сутності (tenant-wide фід — беклог) */
export const ActivityQuerySchema = CursorQuerySchema.extend({
  entityType: z.string().min(1),
  entityId: z.uuid(),
  type: ActivityTypeSchema.optional(),
});

export const ActivityResponseSchema = z.object({
  id: z.uuid(),
  type: ActivityTypeSchema, // фронт усе одно має generic-fallback на невідомий тип
  actorType: z.enum(['user', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()), // форму звужує ACTIVITY_PAYLOAD_SCHEMAS[type]
  createdAt: z.iso.datetime(), // як усі дати в контрактах — ISO-рядок, формат — Intl на фронті
});

export const ActivityListResponseSchema = cursorResponseSchema(ActivityResponseSchema);
