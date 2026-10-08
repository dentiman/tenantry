import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { Blocks } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { activeItemId } from './active-item';
import { collectNavigation, defineArea, defineMenu, type MenuItem } from './registry';
import { visibleMenuItems } from './visibility';

const area = defineArea({
  id: 'workspace',
  prefix: '/workspace',
  label: 'Workspace',
  icon: Blocks,
  order: 1,
  panel: 'menu',
});
const menu = defineMenu({ id: 'customers.detail' });
const overview: MenuItem = {
  id: 'overview',
  menu,
  order: 10,
  label: 'Overview',
  link: { to: '/customers/$customerId' },
  match: 'exact',
};
const events: MenuItem = {
  id: 'events',
  menu,
  order: 20,
  label: 'Events',
  link: { to: '/customers/$customerId/events' },
};
const root = createRootRoute();
const detail = createRoute({ getParentRoute: () => root, path: 'customers/$customerId' });
const index = createRoute({ getParentRoute: () => detail, path: '/' });
const eventsRoute = createRoute({
  getParentRoute: () => detail,
  path: 'events',
  staticData: { access: 'admin' },
} as never);
const router = createRouter({
  routeTree: root.addChildren([detail.addChildren([index, eventsRoute])]),
  history: createMemoryHistory(),
});
const modules = {
  customers: { areas: [area], menus: [menu], menuItems: [overview] },
  calendar: { menuItems: [events] },
};
const nav = collectNavigation(modules, { defaultArea: area });

describe('local navigation menus', () => {
  it('merges contributions in order without adding an area or changing the workspace menu', () => {
    expect(nav.menuItemsOf(menu).map((item) => item.id)).toEqual(['overview', 'events']);
    expect(nav.areas).toEqual([area]);
    expect(nav.itemsOf(area)).toEqual([]);
    expect(
      collectNavigation({ customers: modules.customers }, { defaultArea: area }).menuItemsOf(menu),
    ).toEqual([overview]);
  });

  it('rejects duplicate menus, duplicate items, unknown menus and non-finite order', () => {
    const run = (extra: Parameters<typeof collectNavigation>[0][string]) => () =>
      collectNavigation({ ...modules, extra }, { defaultArea: area });
    expect(run({ menus: [menu] })).toThrow(/duplicate menu/);
    expect(run({ menuItems: [overview] })).toThrow(/duplicate item/);
    expect(
      run({ menuItems: [{ ...overview, id: 'unknown', menu: defineMenu({ id: 'missing' }) }] }),
    ).toThrow(/not registered/);
    expect(run({ menuItems: [{ ...overview, id: 'bad-order', order: Infinity }] })).toThrow(
      /non-finite/,
    );
  });

  it('checks access against the parameterized route, including parent access', () => {
    expect(visibleMenuItems(nav, menu, router, (access) => access !== 'admin')).toEqual([overview]);
    expect(visibleMenuItems(nav, menu, router, () => true)).toEqual([overview, events]);
    detail.update({ staticData: { access: 'admin' } });
    expect(visibleMenuItems(nav, menu, router, (access) => access !== 'admin')).toEqual([]);
    detail.update({ staticData: {} });
  });

  it('resolves entity params and follows exact, nested and trailing-slash URLs', () => {
    const links = nav
      .menuItemsOf(menu)
      .map((item) => ({
        ...item,
        pathname: router.buildLocation({ to: item.link.to, params: { customerId: 'customer-42' } })
          .pathname,
      }));
    expect(links.map((item) => item.pathname)).toEqual([
      '/customers/customer-42',
      '/customers/customer-42/events',
    ]);
    expect(activeItemId(links, '/customers/customer-42/')).toBe('overview');
    expect(activeItemId(links, '/customers/customer-42/events')).toBe('events');
    expect(activeItemId(links, '/customers/customer-42/events/event-1')).toBe('events');
    expect(activeItemId(links, '/customers/customer-42/events-old')).toBeUndefined();
    expect(activeItemId(links, '/customers/another/events')).toBeUndefined();
    expect(activeItemId(links, '/customers/customer-42')).toBe('overview');
  });
});
