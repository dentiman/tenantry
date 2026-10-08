import { ShieldCheck } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { useActiveArea, useRailAreas, type Area } from '@saas-skeleton/ui/navigation';

/**
 * Кнопка ПУНКТУ рейлу — дослівна копія `apps/web/src/app-shell/app-rail.tsx`
 * (там детальне пояснення метрики і граблі з `group-data-[collapsible=icon]:`).
 */
const RAIL_NAV_BUTTON = 'size-8! justify-center group-data-[collapsible=icon]:size-8!';

/** Кнопка-ЯКІР рейлу — бренд угорі. Дослівна копія метрики з `apps/web`. */
const RAIL_ANCHOR_BUTTON =
  'size-10! justify-center p-0! [&_svg]:size-5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! ' +
  'hover:bg-transparent active:bg-transparent data-open:hover:bg-transparent';

/**
 * Перший рівень навігації — вузька смуга іконок area. Дзеркало
 * `apps/web/src/app-shell/app-rail.tsx`: тут рейл вимагає ≥2 area, інакше він
 * декорація — Tenants і Operations дають дві реальні (`docs/frontend/app-shell.md`
 * §«Шел apps/platform-web»).
 *
 * Доступ до розділів рейл бере з роутів (`staticData.access`), як у web; ролей оператора поки немає.
 */
export function AppRail() {
  const activeAreaId = useActiveArea()?.id;
  const areas = useRailAreas();

  return (
    <Sidebar
      collapsible="none"
      className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r border-sidebar-border group-data-[collapsible=icon]:border-r-0"
    >
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border p-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <AppBrand />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {areas.map((area) => (
                <AppRailItem key={area.id} area={area} isActive={activeAreaId === area.id} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

/**
 * Бренд у шапці рейлу. `ShieldCheck` — той самий знак, що був у знятому
 * `AppLayout`; веде на домівку першої area (`/tenants`).
 */
function AppBrand() {
  const { t } = useTranslation('layout');
  const { isMobile, setOpenMobile } = useSidebar();
  const label = t('brand');

  return (
    <SidebarMenuButton
      className={RAIL_ANCHOR_BUTTON}
      tooltip={{ children: label, hidden: isMobile }}
      aria-label={label}
      render={<Link to="/tenants" />}
      onClick={() => {
        if (isMobile) {
          setOpenMobile(false);
        }
      }}
    >
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <ShieldCheck />
      </div>
    </SidebarMenuButton>
  );
}

/** Пункт рейлу. Активний — `button`, неактивний — `Link` (див. `apps/web` для обґрунтування). */
function AppRailItem({ area, isActive }: { area: Area; isActive: boolean }) {
  const { t } = useTranslation('layout');
  const { isMobile, setOpen, setOpenMobile, toggleSidebar } = useSidebar();
  const Icon = area.icon;
  const label = t(area.label);
  const tooltip = { children: label, hidden: isMobile };

  if (isActive) {
    return (
      <SidebarMenuButton
        isActive
        tooltip={tooltip}
        className={RAIL_NAV_BUTTON}
        aria-label={label}
        onClick={toggleSidebar}
      >
        <Icon />
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton
      tooltip={tooltip}
      className={RAIL_NAV_BUTTON}
      aria-label={label}
      render={<Link to={area.prefix} />}
      onClick={() => {
        setOpen(true);
        if (isMobile) {
          setOpenMobile(false);
        }
      }}
    >
      <Icon />
    </SidebarMenuButton>
  );
}
