import { linkOptions } from '@tanstack/react-router';
import { Building2, Settings } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «Settings» — налаштування ОРГАНІЗАЦІЇ (доступ — `staticData.access` на `settingsRoute`).
 * Решту її пунктів додають модулі-власники сторінок: calendar, numbering, ai, activities.
 */
export const settingsArea = defineArea({
  id: 'settings',
  prefix: linkOptions({ to: '/settings' }).to,
  label: 'layout:areas.settings',
  icon: Settings,
  order: 40,
  panel: 'menu',
});

export default defineNavigation({
  areas: [settingsArea],
  items: [
    {
      id: 'settings.general',
      area: settingsArea,
      order: 10,
      link: linkOptions({ to: '/settings' }),
      label: 'settings:nav.general',
      icon: Building2,
      match: 'exact',
    },
  ],
});
