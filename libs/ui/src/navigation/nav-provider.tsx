import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import type { AccessPredicate, RouteLookup } from './access';
import { isUnder, type Area, type NavItem, type NavMenu, type Navigation } from './registry';
import { visibleItems, visibleMenuItems, visibleRailAreas } from './visibility';

interface NavContextValue {
  readonly navigation: Navigation;
  readonly allow: AccessPredicate;
}

const NavContext = createContext<NavContextValue | null>(null);

/**
 * Роздає зібраний реєстр і предикат доступу (`allow` застосунок звʼязує з поточним юзером і
 * міняє його посилання, коли юзер міняється). Той самий патерн, що `SlotsProvider`: шел
 * не імпортує `nav.ts`, а читає реєстр звідси.
 */
export function NavProvider({
  navigation,
  allow,
  children,
}: {
  navigation: Navigation;
  allow: AccessPredicate;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ navigation, allow }), [navigation, allow]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav(): NavContextValue {
  const value = useContext(NavContext);
  if (!value) throw new Error('NavProvider is missing');
  return value;
}

/** Розділи рейлу, видимі поточному юзеру, у порядку `order` */
export function useRailAreas(): readonly Area[] {
  const { navigation, allow } = useNav();
  const router = useRouter();
  return useMemo(
    () => visibleRailAreas(navigation, router as unknown as RouteLookup, allow),
    [navigation, router, allow],
  );
}

/**
 * Активний розділ — ЧИСТА ФУНКЦІЯ від pathname: дубльованого стану «яка area вибрана» немає,
 * тож F5, back/forward і зовнішнє посилання дають те саме, що клік. `undefined` — легальний
 * результат (шлях поза розділами): рейл тоді не підсвічує нічого.
 */
export function useActiveArea(): Area | undefined {
  const { navigation } = useNav();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return navigation.resolveArea(pathname);
}

/** Розділ, чия колонка показується: активний або — поза розділами — `defaultArea` */
export function useDisplayedArea(): Area {
  const { navigation } = useNav();
  return useActiveArea() ?? navigation.defaultArea;
}

/** Розділ за id — для панелей, які самі малюють меню свого розділу (не імпортуючи його `*.nav.ts`) */
export function useAreaById(areaId: string): Area {
  const { navigation } = useNav();
  const area = navigation.areas.find((candidate) => candidate.id === areaId);
  if (!area) throw new Error(`navigation: area "${areaId}" is not registered`);
  return area;
}

export function useAreaItems(area: Area): readonly NavItem[] {
  const { navigation, allow } = useNav();
  const router = useRouter();
  return useMemo(
    () => visibleItems(navigation, area, router as unknown as RouteLookup, allow),
    [navigation, area, router, allow],
  );
}

/**
 * Список пунктів меню розділу в другій колонці — спільний для обох фронтендів. Розділи, чия
 * колонка не меню (`panel` — компонент), його не використовують.
 */
export function AreaNav({ areaId }: { areaId: string }) {
  const { t } = useTranslation();
  const items = useAreaItems(useAreaById(areaId));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={
                    item.match === 'exact'
                      ? pathname === item.link.to
                      : isUnder(pathname, item.link.to)
                  }
                  render={<Link to={item.link.to} />}
                  onClick={() => {
                    // На мобільному сайдбар — це Sheet поверх контенту: без цього він
                    // лишався б відкритим над сторінкою, на яку щойно перейшли
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <Icon />
                  <span>{t(item.label)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Локальне меню читає той самий реєстр і той самий предикат доступу, що й шел. */
export function useMenuItems(menu: NavMenu) {
  const { navigation, allow } = useNav();
  const router = useRouter();
  return useMemo(
    () => visibleMenuItems(navigation, menu, router as unknown as RouteLookup, allow),
    [navigation, menu, router, allow],
  );
}
