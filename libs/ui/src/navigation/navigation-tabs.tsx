import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { useMenuItems } from './nav-provider';
import type { NavMenu } from './registry';
import { activeItemId } from './active-item';

/** URL залишається джерелом стану; параметри сутності надає сторінка-власник. */
export function NavigationTabs({
  menu,
  params,
}: {
  menu: NavMenu;
  params: Record<string, string>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items = useMenuItems(menu);
  const active = activeItemId(
    items.map((item) => ({
      ...item,
      pathname: router.buildLocation({ to: item.link.to, params }).pathname,
    })),
    pathname,
  );

  if (items.length === 0) return null;

  return (
    <Tabs value={active ?? null}>
      <TabsList activateOnFocus={false}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              nativeButton={false}
              render={<Link to={item.link.to} params={params} />}
            >
              {Icon && <Icon />}
              {t(item.label)}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
