import { z } from 'zod';
import { mergeTypeGroups, type TypeTexts } from './activity/activity-definition';
import type { NotificationTypeDef } from './notification/notification-definition';
import { USER_NOTIFICATIONS } from './user/user.notifications';
import { CUSTOMER_NOTIFICATIONS } from './customer/customer.notifications';
import { CALENDAR_NOTIFICATIONS } from './calendar/calendar.notifications';
import { AUTH_NOTIFICATIONS } from './auth/auth.notifications';

/**
 * Composition root типів сповіщень (docs/modules.md §7.1): єдине місце, що знає,
 * які модулі шлють сповіщення. Визначення — у контрактах власників; прибираючи фічу з
 * форку, прибери її рядок тут. Порядок груп — порядок рядків на екрані налаштувань.
 */
export const NOTIFICATION_DEFINITIONS = mergeTypeGroups(
  USER_NOTIFICATIONS,
  CUSTOMER_NOTIFICATIONS,
  CALENDAR_NOTIFICATIONS,
  AUTH_NOTIFICATIONS,
);

export type NotificationType = Extract<keyof typeof NOTIFICATION_DEFINITIONS, string>;

/** Закритий перелік типів — виводиться з визначень, руками не дописується */
export const NOTIFICATION_TYPES = Object.keys(
  NOTIFICATION_DEFINITIONS,
) as readonly NotificationType[];
export const NotificationTypeSchema = z.enum(
  NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]],
);

/** Форма payload-у по типу: recorder валідує на записі, фронт знає, що інтерполювати */
export const NOTIFICATION_PAYLOAD_SCHEMAS = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type, NOTIFICATION_DEFINITIONS[type].payload]),
) as { readonly [K in NotificationType]: (typeof NOTIFICATION_DEFINITIONS)[K]['payload'] };

export type NotificationCategory = (typeof NOTIFICATION_DEFINITIONS)[NotificationType]['category'];
export const NotificationCategorySchema = z.enum([
  ...new Set(NOTIFICATION_TYPES.map((type) => NOTIFICATION_DEFINITIONS[type].category)),
] as [NotificationCategory, ...NotificationCategory[]]);

export interface NotificationTypeMeta {
  readonly category: NotificationCategory;
  readonly defaultEnabled: boolean;
  readonly muteable: boolean;
}

/** Метадані типу (дефолти преференсів) — з тих самих визначень */
export const NOTIFICATION_TYPE_META: Readonly<Record<NotificationType, NotificationTypeMeta>> =
  NOTIFICATION_DEFINITIONS;

export type NotificationDefinition = NotificationTypeDef & { readonly texts: TypeTexts };

/** Визначення за рядком із відповіді API; `undefined` — фронт старіший за бекенд */
export function notificationDefinition(type: string): NotificationDefinition | undefined {
  return (NOTIFICATION_DEFINITIONS as Partial<Record<string, NotificationDefinition>>)[type];
}
