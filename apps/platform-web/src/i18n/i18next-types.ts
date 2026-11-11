import 'i18next';
import type { resources } from './namespaces';

/**
 * Compile-time перевірка ключів `t()` — дзеркало `apps/web/src/i18n/i18next-types.ts` (там і
 * пояснення, чому розширюється `i18next`, а не `react-i18next`, і чому файл `.ts`, а не `.d.ts`).
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['en'];
  }
}
