import { linkOptions } from '@tanstack/react-router';
import { Palette, ShieldCheck, UserCog, Wrench } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «User settings» — ОСОБИСТЕ, що піде з людиною (docs/settings.md). Без пункту в рейлі:
 * вхід — дропдаун аватара, бо в головній навігації словом «Settings» володіє організація.
 */
export const userSettingsArea = defineArea({
  id: 'user-settings',
  prefix: linkOptions({ to: '/user-settings' }).to,
  label: 'layout:areas.userSettings',
  icon: UserCog,
  order: 90,
  rail: false,
  panel: 'menu',
});

export default defineNavigation({
  areas: [userSettingsArea],
  items: [
    {
      id: 'user-settings.profile',
      area: userSettingsArea,
      order: 10,
      link: linkOptions({ to: '/user-settings' }),
      label: 'user-settings:nav.profile',
      icon: UserCog,
      match: 'exact',
    },
    {
      id: 'user-settings.account',
      area: userSettingsArea,
      order: 20,
      link: linkOptions({ to: '/user-settings/account' }),
      label: 'user-settings:nav.account',
      icon: Wrench,
    },
    {
      id: 'user-settings.security',
      area: userSettingsArea,
      order: 30,
      link: linkOptions({ to: '/user-settings/security' }),
      label: 'user-settings:nav.security',
      icon: ShieldCheck,
    },
    {
      id: 'user-settings.appearance',
      area: userSettingsArea,
      order: 50,
      link: linkOptions({ to: '/user-settings/appearance' }),
      label: 'user-settings:nav.appearance',
      icon: Palette,
    },
  ],
});
