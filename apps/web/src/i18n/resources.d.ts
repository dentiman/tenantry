import 'react-i18next';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof import('@saas-skeleton/i18n/locales/en/common.json');
      errors: typeof import('@saas-skeleton/i18n/locales/en/errors.json');
      validation: typeof import('@saas-skeleton/i18n/locales/en/validation.json');
      activities: typeof import('@saas-skeleton/i18n/locales/en/activities.json');
      ai: typeof import('../locales/en/ai.json');
      auth: typeof import('../locales/en/auth.json');
      dashboard: typeof import('../locales/en/dashboard.json');
      jobs: typeof import('../locales/en/jobs.json');
      layout: typeof import('../locales/en/layout.json');
      playground: typeof import('../locales/en/playground.json');
      users: typeof import('../locales/en/users.json');
    };
  }
}
