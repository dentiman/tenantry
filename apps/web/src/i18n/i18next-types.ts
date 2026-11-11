import 'i18next';
import type { resources } from './namespaces';

/**
 * Compile-time перевірка ключів `t()` (docs/i18n-plan.md): опечатка чи видалений ключ — помилка
 * `tsc`, а не сирий ключ у UI.
 *
 * Розширюється саме `i18next`: з i18next ≥ 23 `CustomTypeOptions` живе там, а `react-i18next`
 * лише читає його. Розширення `react-i18next` (так було раніше) мовчки нічого не типізувало.
 *
 * Перелік неймспейсів ВИВЕДЕНИЙ з `namespaces.ts`, а не продубльований: новий неймспейс
 * типізується тим самим рядком, яким реєструється. Файл навмисно `.ts`, а не `.d.ts` —
 * `skipLibCheck` ховає помилки в `.d.ts`, і застарілий перелік роками лишався непоміченим.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['en'];
  }
}
