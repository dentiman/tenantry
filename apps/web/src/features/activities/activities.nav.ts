import { linkOptions } from '@tanstack/react-router';
import { History } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { settingsArea } from '../settings/settings.nav';

export default defineNavigation({
  items: [
    {
      id: 'settings.activity',
      area: settingsArea,
      order: 50,
      link: linkOptions({ to: '/settings/activity' }),
      label: 'settings:nav.activity',
      icon: History,
    },
  ],
});
