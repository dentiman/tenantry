import type { UserResponse } from '@saas-skeleton/contracts';
import {
  visibleItems,
  visibleMenuItems,
  visibleRailAreas,
  type RouteLookup,
} from '@saas-skeleton/ui/navigation';
import { describe, expect, it } from 'vitest';
import { isAllowed } from './features/auth/auth.access';
import { customerDetailMenu } from './features/customers/customers.nav';
import { NAVIGATION } from './nav';
import { router } from './router';

/**
 * Знімок навігації: рейл і меню кожного розділу для кожної ролі. Порядок живе в `order` у
 * розкиданих `*.nav.ts`, тож тут він видно одним поглядом — зміна порядку чи загублений пункт
 * зʼявляється як diff у рев'ю (docs/modules.md §4).
 */
function describeNav(role: UserResponse['role']): string[] {
  const user = { role } as UserResponse;
  const allow = (access: unknown) => isAllowed(access, user);
  const lookup = router as unknown as RouteLookup;
  const rail = visibleRailAreas(NAVIGATION, lookup, allow);
  const lines = [`rail: ${rail.map((area) => area.id).join(', ')}`];
  for (const area of NAVIGATION.areas) {
    const items = visibleItems(NAVIGATION, area, lookup, allow);
    if (items.length > 0) lines.push(`${area.id}: ${items.map((item) => item.id).join(', ')}`);
  }
  lines.push(
    `${customerDetailMenu.id}: ${visibleMenuItems(NAVIGATION, customerDetailMenu, lookup, allow)
      .map((item) => item.id)
      .join(', ')}`,
  );
  return lines;
}

describe('navigation snapshot', () => {
  it('ADMIN', () => {
    expect(describeNav('ADMIN')).toMatchInlineSnapshot(`
      [
        "rail: workspace, calendar, chat, settings, playground, guide",
        "workspace: dashboard, users, customers",
        "settings: settings.general, settings.calendar, settings.numbering, settings.ai, settings.activity",
        "playground: playground.vertical-form, playground.inline-form, playground.dialog",
        "user-settings: user-settings.profile, user-settings.account, user-settings.security, user-settings.notifications, user-settings.appearance",
        "customers.detail: customers.overview, customers.contacts, calendar.customer-events",
      ]
    `);
  });

  it('USER не бачить налаштувань організації', () => {
    expect(describeNav('USER')).toMatchInlineSnapshot(`
      [
        "rail: workspace, calendar, chat, playground, guide",
        "workspace: dashboard, users, customers",
        "playground: playground.vertical-form, playground.inline-form, playground.dialog",
        "user-settings: user-settings.profile, user-settings.account, user-settings.security, user-settings.notifications, user-settings.appearance",
        "customers.detail: customers.overview, customers.contacts, calendar.customer-events",
      ]
    `);
  });
});
