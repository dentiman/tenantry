/**
 * Шляхи, на які веде навігація шела — перелічені літералами, а не `string`.
 *
 * Причина та сама, що була в `SectionPath` (який цей файл і замінив): `Link to` у
 * TanStack Router типізований юніоном реальних роутів, і друкарська помилка в
 * навігації ловиться компіляцією, а не кліком. Юніон росте рядком на кожен новий
 * пункт меню.
 */

/**
 * Префікс URL кожної area. Він же її «домівка»: клік у рейлі веде саме на префікс,
 * а індексний роут area вирішує, що там показати.
 */
export type AreaPrefix = '/workspace' | '/chat' | '/settings' | '/playground' | '/user-settings';

/** Усі адресовані пункти другої колонки (включно з префіксами area — це індексні пункти). */
export type NavPath =
  | '/workspace'
  | '/workspace/users'
  | '/workspace/customers'
  | '/chat'
  | '/settings'
  | '/settings/numbering'
  | '/settings/activity'
  | '/playground'
  | '/user-settings'
  | '/user-settings/account'
  | '/user-settings/security'
  | '/user-settings/notifications'
  | '/user-settings/appearance';

/**
 * «Шлях лежить під префіксом» — саме так, а не `startsWith`: інакше `/chatbot`
 * потрапив би в area `/chat`, а `/settings-old` — у `/settings`.
 */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
