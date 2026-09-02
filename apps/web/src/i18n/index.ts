import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { z } from 'zod';
import { en as zodEn } from 'zod/locales';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  activitiesEn,
  commonEn,
  errorsEn,
  notificationsEn,
  validationEn,
} from '@saas-skeleton/i18n';
import authEn from '../locales/en/auth.json';
import customersEn from '../locales/en/customers.json';
import dashboardEn from '../locales/en/dashboard.json';
import layoutEn from '../locales/en/layout.json';
import playgroundEn from '../locales/en/playground.json';
import settingsEn from '../locales/en/settings.json';
import userSettingsEn from '../locales/en/user-settings.json';
import usersEn from '../locales/en/users.json';

export const LOCALE_STORAGE_KEY = 'saas_locale';

// Локалізує вбудовані повідомлення Zod (zodResolver у формах) — зараз завжди 'en',
// бо SUPPORTED_LOCALES = ['en']; з другою мовою (I18N-4) вибір паку піде за detectLocale()
z.config(zodEn());

function detectLocale(): string {
  const supported: readonly string[] = SUPPORTED_LOCALES;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && supported.includes(stored)) {
    return stored;
  }
  const navigatorLocale = navigator.language.split('-')[0];
  if (navigatorLocale && supported.includes(navigatorLocale)) {
    return navigatorLocale;
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      errors: errorsEn,
      validation: validationEn,
      activities: activitiesEn,
      notifications: notificationsEn,
      auth: authEn,
      dashboard: dashboardEn,
      layout: layoutEn,
      playground: playgroundEn,
      settings: settingsEn,
      users: usersEn,
      customers: customersEn,
      'user-settings': userSettingsEn,
    },
  },
  lng: detectLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  // React вже екранує вивід — подвійне екранування i18next не потрібне
  interpolation: { escapeValue: false },
});

export default i18n;
