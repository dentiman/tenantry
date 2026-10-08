import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Навігація шела як реєстр, який наповнюють самі модулі (docs/modules.md §4).
 *
 * Два рівні: `Area` — розділ рейлу (володіє префіксом URL і другою колонкою) і `NavItem` —
 * пункт меню розділу. Меню — це і є розділ: пункт називає розділ, у який іде, окремого
 * «токена меню» для area немає. Локальна навігація сторінки має окремий `NavMenu`. Оголошує обидва рівні модуль-власник у `<module>.nav.ts`, збирає їх
 * `import.meta.glob` у composition root застосунку (`nav.ts`).
 */

export interface Area {
  /** Глобально унікальний id розділу */
  readonly id: string;
  /** Префікс URL — він же «домівка» розділу: клік у рейлі веде саме сюди */
  readonly prefix: string;
  /** Ключ i18n у форматі `namespace:key` */
  readonly label: string;
  readonly icon: LucideIcon;
  /** Позиція в рейлі; рівні — за id */
  readonly order: number;
  /** `false` — розділ без пункту в рейлі, лише за прямим посиланням (User settings) */
  readonly rail?: boolean;
  /**
   * Вміст ДРУГОЇ колонки: `'menu'` — спільний `AreaNav` із пунктів розділу; компонент — власна
   * панель (список розмов, міні-місяць, зміст), бо друга колонка — контейнер вигляду, а не підменю.
   */
  readonly panel: 'menu' | ComponentType;
}

export interface NavItem {
  /** Глобально унікальний стабільний id (майбутній ключ перевизначень) */
  readonly id: string;
  readonly area: Area;
  readonly order: number;
  /** Результат `linkOptions({ to })` застосунку: тип шляху перевіряє роутер, а не цей пакет */
  readonly link: { readonly to: string };
  /** Ключ i18n у форматі `namespace:key` */
  readonly label: string;
  readonly icon: LucideIcon;
  /**
   * `exact` — для ІНДЕКСНОГО пункту розділу (`/workspace`, `/settings`): за префіксом він
   * світився б на всіх дочірніх шляхах одночасно з ними. За замовчуванням — `prefix`.
   */
  readonly match?: 'exact' | 'prefix';
}

/** Локальне меню сторінки: не володіє рейлом, URL-префіксом чи другою колонкою. */
export interface NavMenu {
  readonly id: string;
}

export interface MenuItem extends Omit<NavItem, 'area' | 'icon'> {
  readonly menu: NavMenu;
  readonly icon?: LucideIcon;
}

export function defineMenu(menu: NavMenu): NavMenu {
  return menu;
}

export interface NavigationModule {
  readonly menus?: readonly NavMenu[];
  readonly menuItems?: readonly MenuItem[];
  readonly areas?: readonly Area[];
  readonly items?: readonly NavItem[];
}

export function defineArea(area: Area): Area {
  return area;
}

export function defineNavigation(module: NavigationModule): NavigationModule {
  return module;
}

/**
 * «Шлях лежить під префіксом» — саме так, а не `startsWith`: інакше `/chatbot` потрапив би в
 * розділ `/chat`, а `/settings-old` — у `/settings`.
 */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export interface Navigation {
  /** Усі розділи, за `(order, id)` */
  readonly areas: readonly Area[];
  /** Куди падає шлях поза всіма розділами (404): навігація лишається, щоб був вихід */
  readonly defaultArea: Area;
  itemsOf(area: Area): readonly NavItem[];
  menuItemsOf(menu: NavMenu): readonly MenuItem[];
  /** Розділ, чий префікс містить шлях; `undefined` — шлях поза розділами */
  resolveArea(pathname: string): Area | undefined;
}

function byOrderThenId(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/**
 * Збирає внески модулів у реєстр і ПАДАЄ одразу при завантаженні модуля — у dev це старт, у
 * тестах — сам тест — а не мовчки показує половину меню: дубль id, вкладені або однакові
 * префікси, пункт у нереєстрованому розділі, нескінченний order, незареєстрований
 * `defaultArea`.
 */
export function collectNavigation(
  modules: Readonly<Record<string, NavigationModule | undefined>>,
  options: { defaultArea: Area },
): Navigation {
  const areas: Area[] = [];
  const items: NavItem[] = [];
  const menus: NavMenu[] = [];
  const menuItems: MenuItem[] = [];
  const source = new Map<string, string>();

  for (const [file, module] of Object.entries(modules)) {
    for (const menu of module?.menus ?? []) {
      assertUnique(source, `menu:${menu.id}`, file);
      menus.push(menu);
    }
    for (const item of module?.menuItems ?? []) {
      assertOrder(item.id, item.order, file);
      assertUnique(source, `item:${item.id}`, file);
      menuItems.push(item);
    }
    for (const area of module?.areas ?? []) {
      assertOrder(area.id, area.order, file);
      assertUnique(source, `area:${area.id}`, file);
      areas.push(area);
    }
    for (const item of module?.items ?? []) {
      assertOrder(item.id, item.order, file);
      assertUnique(source, `item:${item.id}`, file);
      items.push(item);
    }
  }

  for (const [i, a] of areas.entries()) {
    for (const b of areas.slice(i + 1)) {
      if (isUnder(a.prefix, b.prefix) || isUnder(b.prefix, a.prefix)) {
        throw new Error(
          `navigation: area prefixes overlap: "${a.id}" (${a.prefix}) and "${b.id}" (${b.prefix})`,
        );
      }
    }
  }

  const registered = new Set(areas);
  for (const item of items) {
    if (!registered.has(item.area)) {
      throw new Error(
        `navigation: item "${item.id}" targets area "${item.area.id}" that is not registered`,
      );
    }
  }
  if (!registered.has(options.defaultArea)) {
    throw new Error(`navigation: default area "${options.defaultArea.id}" is not registered`);
  }

  const itemsByMenu = new Map<NavMenu, MenuItem[]>(menus.map((menu) => [menu, []]));
  for (const item of [...menuItems].sort(byOrderThenId)) {
    const entries = itemsByMenu.get(item.menu);
    if (!entries) {
      throw new Error(
        `navigation: item "${item.id}" targets menu "${item.menu.id}" that is not registered`,
      );
    }
    entries.push(item);
  }

  const sortedAreas = [...areas].sort(byOrderThenId);
  const itemsByArea = new Map<Area, NavItem[]>(sortedAreas.map((area) => [area, []]));
  for (const item of [...items].sort(byOrderThenId)) itemsByArea.get(item.area)?.push(item);

  return {
    areas: sortedAreas,
    defaultArea: options.defaultArea,
    itemsOf: (area) => itemsByArea.get(area) ?? [],
    menuItemsOf: (menu) => itemsByMenu.get(menu) ?? [],
    resolveArea: (pathname) => sortedAreas.find((area) => isUnder(pathname, area.prefix)),
  };
}

function assertOrder(id: string, order: number, file: string): void {
  if (!Number.isFinite(order))
    throw new Error(`navigation: "${id}" in ${file} has a non-finite order`);
}

function assertUnique(source: Map<string, string>, key: string, file: string): void {
  const previous = source.get(key);
  if (previous !== undefined) {
    throw new Error(
      `navigation: duplicate ${key.replace(':', ' id "')}" in ${file} (already in ${previous})`,
    );
  }
  source.set(key, file);
}
