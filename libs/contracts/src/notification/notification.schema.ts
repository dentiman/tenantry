import { z } from 'zod';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';
// Перелік типів і категорій збирає root із визначень модулів-власників (docs/module-registries.md R1)
import { NotificationCategorySchema, NotificationTypeSchema } from '../notification-types';

/**
 * Контракти персонального інбокса (docs/notifications.md).
 *
 * Межа з Activity Log: активність відповідає на «що сталося з сутністю» і стану не має;
 * сповіщення — «що Я маю знати», у нього є отримувач і стан прочитання. Текст, як і в
 * activities, НЕ зберігається: type + payload, рендерить фронт через i18next.
 */

/**
 * Канали доставки. У V1 живий рівно один, але ключ (type, channel) закладений з
 * першого дня: email/push додаються рядком у преференсах, а не міграцією семантики.
 */
export const NOTIFICATION_CHANNELS = ['in_app'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// ---------------------------------------------------------------- читання

export const NotificationFilterSchema = z.enum(['unread', 'all', 'archived']);
export type NotificationFilter = z.infer<typeof NotificationFilterSchema>;

/**
 * Інбокс ЗАВЖДИ свій: отримувач береться з токена, у query його немає і не буде.
 * Курсор — той самий keyset-контракт, що в activities (base64url, непрозорий).
 */
export const NotificationQuerySchema = CursorQuerySchema.extend({
  filter: NotificationFilterSchema.default('all'),
});

/** Куди веде клік. Nullable: буває сповіщення без переходу (welcome) */
export const NotificationTargetSchema = z.object({
  kind: z.string().min(1),
  id: z.uuid(),
});

export const NotificationResponseSchema = z.object({
  id: z.uuid(),
  type: NotificationTypeSchema, // фронт усе одно має generic-fallback на невідомий тип
  payload: z.record(z.string(), z.unknown()), // форму звужує NOTIFICATION_PAYLOAD_SCHEMAS[type]
  target: NotificationTargetSchema.nullable(),
  /** >1 = схлопнута група (N однотипних подій в одному рядку) */
  groupCount: z.number().int().min(1),
  actorType: z.enum(['user', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Час останньої появи: по ньому сортується фід, його ж рухає колапс */
  updatedAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export const NotificationListResponseSchema = cursorResponseSchema(NotificationResponseSchema);

/**
 * Snapshot для бейджа — той самий патерн, що PresenceSnapshot: повний стан по HTTP,
 * дельти по socket, звірка за revision.
 *
 * Два числа, а не одне, свідомо: `unreadCount` росте, поки юзер не розбере інбокс, і
 * бейдж із ним за тиждень показував би «47». На бейджі — `newCount` (з'явилося після
 * останнього відкриття панелі): відкрив, навіть нічого не прочитавши, — бейдж згас,
 * непрочитані лишились жирними.
 */
export const NotificationSummarySchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});

// ---------------------------------------------------------------- зміна стану

/**
 * Стан одного рядка. Обидва поля опційні, але хоч одне мусить бути — інакше це
 * порожній PATCH, який мовчки нічого не робить.
 */
export const UpdateNotificationSchema = z
  .object({
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.read !== undefined || v.archived !== undefined, {
    message: 'Provide at least one of "read" or "archived"',
  });
export type UpdateNotification = z.infer<typeof UpdateNotificationSchema>;

// ---------------------------------------------------------------- преференси

/**
 * Ефективний преференс = дефолт із NOTIFICATION_TYPE_META, перекритий рядком БД.
 * Віддаємо ЗАВЖДИ повний список типів: фронт не має знати реєстр, щоб намалювати екран.
 */
export const NotificationPreferenceSchema = z.object({
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
  category: NotificationCategorySchema,
  /** false — перемикача немає, тільки підпис «завжди» */
  muteable: z.boolean(),
});

export const NotificationPreferenceListSchema = z.object({
  items: z.array(NotificationPreferenceSchema),
});

/** Upsert набору. Немутабельні типи сервер відхиляє, а не тихо ігнорує */
export const UpdateNotificationPreferencesSchema = z.object({
  items: z
    .array(
      z.object({
        type: NotificationTypeSchema,
        channel: NotificationChannelSchema,
        enabled: z.boolean(),
      }),
    )
    .min(1),
});
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferencesSchema>;
