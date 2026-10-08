import { linkOptions } from '@tanstack/react-router';
import { Palette, UserCog } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «User settings» — особисте оператора. Без пункту в рейлі: вхід — дропдаун аватара
 * (docs/settings.md, ті самі підстави, що в web).
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
      id: 'user-settings.appearance',
      area: userSettingsArea,
      order: 20,
      link: linkOptions({ to: '/user-settings/appearance' }),
      label: 'user-settings:nav.appearance',
      icon: Palette,
    },
  ],
});
