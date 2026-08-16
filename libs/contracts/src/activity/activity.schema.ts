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
  'user.enabled',
  'user.disabled',
  'email.sent',
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
  'user.enabled': z.object({
    user: EntityRefSchema,
  }),
  'user.disabled': z.object({
    user: EntityRefSchema,
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
