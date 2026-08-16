import common from './locales/en/common.json';
import errors from './locales/en/errors.json';
import validation from './locales/en/validation.json';
import activities from './locales/en/activities.json';
import notifications from './locales/en/notifications.json';

/** Заповнюється в I18N-4: друга мова + мова, обрана в UI */
export const SUPPORTED_LOCALES = ['en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

// activities/notifications — спільні фронтові namespace-и (рендер журналу подій та
// інбокса; web зараз, platform-web потенційно) — тому в libs/i18n, а не в apps/*/locales.
// УВАГА: `notifications` тут — це in-app інбокс. Однойменний namespace у
// apps/worker/src/locales — контент email-ів, інший процес, спільного нічого.
export const en = { common, errors, validation, activities, notifications };
export {
  common as commonEn,
  errors as errorsEn,
  validation as validationEn,
  activities as activitiesEn,
  notifications as notificationsEn,
};
