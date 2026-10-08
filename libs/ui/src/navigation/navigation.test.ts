import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Blocks, Settings } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { allMatchesAllowed, isRouteAllowed } from './access';
import { collectNavigation, defineArea, defineNavigation, isUnder, type NavItem } from './registry';
import { visibleItems, visibleRailAreas } from './visibility';

const area = (id: string, prefix: string, order: number, extra: object = {}) =>
  defineArea({ id, prefix, label: id, icon: Blocks, order, panel: 'menu', ...extra });
const item = (id: string, a: ReturnType<typeof area>, order: number, to: string): NavItem => ({
  id,
  area: a,
  order,
  link: { to },
  label: id,
  icon: Settings,
});

describe('isUnder', () => {
  it('префікс, а не startsWith', () => {
    expect(isUnder('/chat', '/chat')).toBe(true);
    expect(isUnder('/chat/1', '/chat')).toBe(true);
    expect(isUnder('/chatbot', '/chat')).toBe(false);
  });
});

describe('collectNavigation', () => {
  const ws = area('workspace', '/workspace', 10);
  const settings = area('settings', '/settings', 40);
  const calendar = area('calendar', '/calendar', 20);

  it('сортує розділи і пункти за order, потім за id', () => {
    const nav = collectNavigation(
      {
        a: defineNavigation({
          areas: [settings, ws, calendar],
          items: [item('b', ws, 20, '/b'), item('a', ws, 20, '/a'), item('c', ws, 10, '/c')],
        }),
      },
      { defaultArea: ws },
    );
    expect(nav.areas.map((x) => x.id)).toEqual(['workspace', 'calendar', 'settings']);
    expect(nav.itemsOf(ws).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('пункт з іншого модуля потрапляє в чужий розділ', () => {
    const nav = collectNavigation(
      {
        s: defineNavigation({ areas: [settings, ws] }),
        c: defineNavigation({ areas: [calendar], items: [item('calendar.settings', settings, 20, '/settings/calendar')] }),
      },
      { defaultArea: ws },
    );
    expect(nav.itemsOf(settings).map((x) => x.id)).toEqual(['calendar.settings']);
  });

  it('розділ шукається за префіксом шляху', () => {
    const nav = collectNavigation({ m: defineNavigation({ areas: [ws, settings] }) }, { defaultArea: ws });
    expect(nav.resolveArea('/settings/ai')?.id).toBe('settings');
    expect(nav.resolveArea('/settings-old')).toBeUndefined();
  });

  it('падає на дублі, вкладених префіксах, нереєстрованому розділі й нескінченному order', () => {
    const run = (m: Parameters<typeof collectNavigation>[0], d = ws) => () => collectNavigation(m, { defaultArea: d });
    expect(run({ a: { areas: [ws] }, b: { areas: [ws] } })).toThrow(/duplicate area id "workspace"/);
    expect(run({ a: { areas: [ws], items: [item('x', ws, 1, '/x'), item('x', ws, 2, '/y')] } })).toThrow(/duplicate item id "x"/);
    expect(run({ a: { areas: [ws, area('inner', '/workspace/inner', 1)] } })).toThrow(/overlap/);
    expect(run({ a: { areas: [ws], items: [item('x', settings, 1, '/x')] } })).toThrow(/not registered/);
    expect(run({ a: { areas: [area('w', '/w', Number.NaN)] } }, area('w', '/w', 1))).toThrow(/non-finite/);
    expect(run({ a: { areas: [settings] } })).toThrow(/default area/);
  });
});

describe('доступ за маршрутом', () => {
  const allowAdmin = (role: 'ADMIN' | 'USER') => (access: unknown) =>
    !access || (access as { roles: string[] }).roles.includes(role);

  const root = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    staticData: { access: { roles: ['ADMIN'] } },
  } as never);
  const settingsIndex = createRoute({ getParentRoute: () => settingsRoute, path: '/' });
  const settingsAi = createRoute({ getParentRoute: () => settingsRoute, path: 'ai' });
  const workspace = createRoute({ getParentRoute: () => root, path: '/workspace' });
  const dashboard = createRoute({ getParentRoute: () => workspace, path: '/' });
  const router = createRouter({
    routeTree: root.addChildren([settingsRoute.addChildren([settingsIndex, settingsAi]), workspace.addChildren([dashboard])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  it('обмеження лейаута діє на дітей і на індексний роут', () => {
    expect(isRouteAllowed(router, '/settings', allowAdmin('USER'))).toBe(false);
    expect(isRouteAllowed(router, '/settings/ai', allowAdmin('USER'))).toBe(false);
    expect(isRouteAllowed(router, '/settings/ai', allowAdmin('ADMIN'))).toBe(true);
    expect(isRouteAllowed(router, '/workspace', allowAdmin('USER'))).toBe(true);
    expect(isRouteAllowed(router, '/nope', allowAdmin('USER'))).toBe(true);
  });

  it('гейт перевіряє всі збіги', () => {
    const matches = [{ staticData: {} }, { staticData: { access: { roles: ['ADMIN'] } } }];
    expect(allMatchesAllowed(matches, allowAdmin('USER'))).toBe(false);
    expect(allMatchesAllowed(matches, allowAdmin('ADMIN'))).toBe(true);
  });

  it('рейл ховає недоступні розділи і розділи-меню без видимих пунктів', () => {
    const ws = area('workspace', '/workspace', 10);
    const st = area('settings', '/settings', 40);
    const empty = area('empty', '/empty', 50);
    const chat = area('chat', '/chat', 30, { panel: () => null });
    const hidden = area('user-settings', '/user-settings', 90, { rail: false });
    const nav = collectNavigation(
      {
        m: defineNavigation({
          areas: [ws, st, empty, chat, hidden],
          items: [item('d', ws, 10, '/workspace'), item('ai', st, 10, '/settings/ai')],
        }),
      },
      { defaultArea: ws },
    );
    expect(visibleRailAreas(nav, router, allowAdmin('USER')).map((a) => a.id)).toEqual(['workspace', 'chat']);
    expect(visibleRailAreas(nav, router, allowAdmin('ADMIN')).map((a) => a.id)).toEqual(['workspace', 'chat', 'settings']);
    expect(visibleItems(nav, st, router, allowAdmin('USER'))).toEqual([]);
  });
});
