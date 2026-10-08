/**
 * Доступ до сторінки оголошує РОУТ (`staticData.access`), а все інше з нього виводиться: гейт
 * при переході, видимість пункту меню і розділу в рейлі. Одне джерело правди — тому «пункт є, а
 * клік повертає назад» неможливий (і навпаки).
 *
 * Це видимість і зручність, а не захист: enforcement — бекенд (`@Roles`).
 */

/** `allow` — предикат застосунку (хто зараз залогінений і що йому можна) */
export type AccessPredicate = (access: unknown) => boolean;

interface RouteLike {
  readonly parentRoute?: RouteLike;
  readonly options: { readonly staticData?: { readonly access?: unknown } };
}

export interface RouteLookup {
  readonly routesByPath: Readonly<Record<string, RouteLike | undefined>>;
}

/** Для гейта: усі збіги шляху (`beforeLoad.matches`) мусять пустити юзера */
export function allMatchesAllowed(
  matches: readonly { readonly staticData?: { readonly access?: unknown } }[],
  allow: AccessPredicate,
): boolean {
  return matches.every((match) => allow(match.staticData?.access));
}

/**
 * Чи пустить роут за `to` поточного юзера — з урахуванням усіх батьків: обмеження на лейауті
 * діє на всіх дітей. Невідомий шлях вважаємо доступним: цим займається 404, а не навігація.
 */
export function isRouteAllowed(router: RouteLookup, to: string, allow: AccessPredicate): boolean {
  const key = to.length > 1 && to.endsWith('/') ? to.slice(0, -1) : to;
  let route = router.routesByPath[key];
  while (route) {
    if (!allow(route.options.staticData?.access)) return false;
    route = route.parentRoute;
  }
  return true;
}
