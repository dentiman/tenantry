import {
  activitiesEn,
  commonEn,
  errorsEn,
  notificationsEn,
  validationEn,
} from '@saas-skeleton/i18n';
import aiEn from '../locales/en/ai.json';
import authEn from '../locales/en/auth.json';
import calendarEn from '../locales/en/calendar.json';
import chatEn from '../locales/en/chat.json';
import customersEn from '../locales/en/customers.json';
import dashboardEn from '../locales/en/dashboard.json';
import guideEn from '../locales/en/guide.json';
import layoutEn from '../locales/en/layout.json';
import playgroundEn from '../locales/en/playground.json';
import settingsEn from '../locales/en/settings.json';
import userSettingsEn from '../locales/en/user-settings.json';
import usersEn from '../locales/en/users.json';

/**
 * Усі неймспейси застосунку. Окремо від `index.ts`, бо той ініціалізує i18next із
 * `window` (локаль із localStorage) — а цей перелік потрібен і тестам у node, які
 * звіряють, що тексти кожного типу з реєстрів контрактів справді існують.
 */
export const resources = {
  en: {
    common: commonEn,
    errors: errorsEn,
    validation: validationEn,
    activities: activitiesEn,
    notifications: notificationsEn,
    ai: aiEn,
    auth: authEn,
    calendar: calendarEn,
    chat: chatEn,
    dashboard: dashboardEn,
    guide: guideEn,
    layout: layoutEn,
    playground: playgroundEn,
    settings: settingsEn,
    users: usersEn,
    customers: customersEn,
    'user-settings': userSettingsEn,
  },
};
