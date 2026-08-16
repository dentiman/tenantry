import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity.schema';
import { CursorQuerySchema, cursorResponseSchema } from '../pagination/pagination.schema';

/**
 * Контракти персонального інбокса (docs/notifications.md).
 *
 * Межа з Activity Log: активність відповідає на «що сталося з сутністю» і стану не має;
 * сповіщення — «що Я маю знати», у нього є отримувач і стан прочитання. Текст, як і в
 * activities, НЕ зберігається: type + payload, рендерить фронт через i18next.
 */

/** Закритий перелік типів — єдине місце додавання нового сповіщення */
export const NOTIFICATION_TYPES = [
  // адмінам тенанта: у воркспейсі з'явився юзер
  'user.created',
  // самому юзеру: адмін змінив йому пароль (security — не вимикається)
  'user.password_changed',
  // новому юзеру, пишеться воркером після welcome-листа
  'user.welcome',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Форма payload-у ПО ТИПУ: recorder валідує на записі (fail fast — невалідний payload
 * це баг викликача), фронт знає, що інтерполювати в i18next-ключ.
 */
export const NOTIFICATION_PAYLOAD_SCHEMAS = {
  'user.created': z.object({ user: EntityRefSchema }),
  // Ні пароля, ні хеша, ні довжини — тільки факт; хто змінив, видно з actorLabel
  'user.password_changed': z.object({}),
  'user.welcome': z.object({ tenant: z.string().min(1) }),
} as const satisfies Record<NotificationType, z.ZodType>;

/**
 * Канали доставки. У V1 живий рівно один, але ключ (type, channel) закладений з
 * першого дня: email/push додаються рядком у преференсах, а не міграцією семантики.
 */
export const NOTIFICATION_CHANNELS = ['in_app'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationCategorySchema = z.enum(['workspace', 'security']);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export interface NotificationTypeMeta {
  readonly category: NotificationCategory;
  readonly defaultEnabled: boolean;
  /**
   * false = юзер не може вимкнути. Це не «забули дати перемикач»: про зміну власного
   * пароля людина мусить дізнатись незалежно від своїх налаштувань.
   */
  readonly muteable: boolean;
}

/**
 * Метадані типу — дефолти живуть у КОДІ, не в БД: новий тип не потребує бекфілу
 * преференсів для наявних юзерів (рядок у notification_preferences з'являється
 * тільки коли юзер явно змінив дефолт).
 */
export const NOTIFICATION_TYPE_META = {
  'user.created': { category: 'workspace', defaultEnabled: true, muteable: true },
  'user.password_changed': { category: 'security', defaultEnabled: true, muteable: false },
  'user.welcome': { category: 'workspace', defaultEnabled: true, muteable: true },
} as const satisfies Record<NotificationType, NotificationTypeMeta>;

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
