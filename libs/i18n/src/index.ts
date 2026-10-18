import common from './locales/en/common.json';
import errors from './locales/en/errors.json';
import validation from './locales/en/validation.json';
import activitiesBase from './locales/en/activities.json';
import customerActivities from './locales/en/activities/customers.json';
import calendarActivities from './locales/en/activities/calendar.json';
import chatActivities from './locales/en/activities/chat.json';
import notifications from './locales/en/notifications.json';

/** Заповнюється в I18N-4: друга мова + мова, обрана в UI */
export const SUPPORTED_LOCALES = ['en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

// activities/notifications — спільні фронтові namespace-и (рендер журналу подій та
// інбокса; web зараз, platform-web потенційно) — тому в libs/i18n, а не в apps/*/locales.
// УВАГА: `notifications` тут — це in-app інбокс. Однойменний namespace у
// apps/worker/src/locales — контент email-ів, інший процес, спільного нічого.
// Тексти типів активності фіч — окремий файл на власника (`activities/<модуль>.json`, у
// `paths` модуля в modules.config.ts), але один неймспейс: стрічку рендерять обидва фронти
// (картки в tenant-web, стрічка тенанта в platform-web), а неймспейси фіч у них різні або
// відсутні. Ключ — сам тип (`customer.created`), тож файли не перетинаються.
const activities = {
  ...activitiesBase,
  ...customerActivities,
  ...calendarActivities,
  ...chatActivities,
};

export const en = { common, errors, validation, activities, notifications };
export {
  common as commonEn,
  errors as errorsEn,
  validation as validationEn,
  activities as activitiesEn,
  notifications as notificationsEn,
};
