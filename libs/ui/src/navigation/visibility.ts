import { isRouteAllowed, type AccessPredicate, type RouteLookup } from './access';
import type { Area, MenuItem, NavItem, NavMenu, Navigation } from './registry';

/** Пункти розділу, чиї сторінки пустять юзера */
export function visibleItems(
  nav: Navigation,
  area: Area,
  router: RouteLookup,
  allow: AccessPredicate,
): readonly NavItem[] {
  return nav.itemsOf(area).filter((item) => isRouteAllowed(router, item.link.to, allow));
}

/**
 * Розділи рейлу: без `rail: false`, з доступною домівкою, а розділ-меню ще й з хоч одним
 * видимим пунктом — інакше юзер бачив би розділ, у якому нічого немає.
 */
export function visibleRailAreas(
  nav: Navigation,
  router: RouteLookup,
  allow: AccessPredicate,
): readonly Area[] {
  return nav.areas.filter(
    (area) =>
      area.rail !== false &&
      isRouteAllowed(router, area.prefix, allow) &&
      (area.panel !== 'menu' || visibleItems(nav, area, router, allow).length > 0),
  );
}

/** Доступ перевіряємо за шаблоном маршруту ($customerId), до підстановки параметрів. */
export function visibleMenuItems(
  nav: Navigation,
  menu: NavMenu,
  router: RouteLookup,
  allow: AccessPredicate,
): readonly MenuItem[] {
  return nav.menuItemsOf(menu).filter((item) => isRouteAllowed(router, item.link.to, allow));
}
