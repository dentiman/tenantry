import { activitiesEn, commonEn, errorsEn, validationEn } from '@saas-skeleton/i18n';
import aiEn from '../locales/en/ai.json';
import authEn from '../locales/en/auth.json';
import chatEn from '../locales/en/chat.json';
import jobsEn from '../locales/en/jobs.json';
import layoutEn from '../locales/en/layout.json';
import tenantsEn from '../locales/en/tenants.json';
import tenantUsersEn from '../locales/en/tenant-users.json';
import userSettingsEn from '../locales/en/user-settings.json';

/**
 * Усі неймспейси застосунку — дзеркало `apps/web/src/i18n/namespaces.ts`. Окремо від `index.ts`,
 * бо той ініціалізує i18next із `window`, а цей перелік потрібен ще й типам (`i18next-types.ts`):
 * із нього виводиться, які ключі приймає `t()`.
 */
export const resources = {
  en: {
    common: commonEn,
    errors: errorsEn,
    validation: validationEn,
    // Стрічка подій тенанта на його картці — той самий рендер, що в tenant-web
    activities: activitiesEn,
    auth: authEn,
    layout: layoutEn,
    tenants: tenantsEn,
    'tenant-users': tenantUsersEn,
    jobs: jobsEn,
    'user-settings': userSettingsEn,
    ai: aiEn,
    chat: chatEn,
  },
};
