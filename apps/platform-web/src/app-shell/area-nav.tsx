import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { isUnder, type NavPath } from './paths';

export interface AreaNavItem {
  to: NavPath;
  label: string;
  icon: ReactNode;
  /**
   * `exact` — для ІНДЕКСНОГО пункту area (`/workspace`, `/settings`): за
   * префіксом він світився б на всіх дочірніх шляхах одночасно з ними.
   */
  match?: 'exact' | 'prefix';
}

/**
 * Список пунктів у другій колонці шела. Спільний для всіх area, які справді є
 * меню — але сам контракт area цього НЕ вимагає: `AppArea.Sidebar` віддає
 * довільний компонент, тож чат може малювати там список розмов із пошуком
 * (див. `areas.tsx`).
 */
export function AreaNav({ items }: { items: AreaNavItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={
                  item.match === 'exact' ? pathname === item.to : isUnder(pathname, item.to)
                }
                render={<Link to={item.to} />}
                onClick={() => {
                  // На мобільному сайдбар — це Sheet поверх контенту: без цього він
                  // лишався б відкритим над сторінкою, на яку щойно перейшли
                  if (isMobile) {
                    setOpenMobile(false);
                  }
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
