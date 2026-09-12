/**
 * Шляхи, на які веде навігація шела — перелічені літералами, а не `string`.
 *
 * Дзеркало `apps/web/src/app-shell/paths.ts`: `Link to` у TanStack Router
 * типізований юніоном реальних роутів, і друкарська помилка в навігації
 * ловиться компіляцією, а не кліком.
 */

/**
 * Префікс URL кожної area. Він же її «домівка»: клік у рейлі веде саме на префікс,
 * а індексний роут area вирішує, що там показати.
 */
export type AreaPrefix = '/tenants' | '/operations' | '/user-settings';

/** Усі адресовані пункти другої колонки (включно з префіксами area — це індексні пункти). */
export type NavPath =
  | '/tenants'
  | '/operations'
  | '/operations/jobs'
  | '/operations/queues'
  | '/user-settings'
  | '/user-settings/appearance';

/**
 * «Шлях лежить під префіксом» — саме так, а не `startsWith`: інакше `/tenants-old`
 * потрапив би в area `/tenants`.
 */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
