import { linkOptions } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { userSettingsArea } from '../account/account.nav';

export default defineNavigation({
  items: [
    {
      id: 'user-settings.notifications',
      area: userSettingsArea,
      order: 40,
      link: linkOptions({ to: '/user-settings/notifications' }),
      label: 'user-settings:nav.notifications',
      icon: Bell,
    },
  ],
});
