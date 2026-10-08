import { linkOptions } from '@tanstack/react-router';
import { Hash } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { settingsArea } from '../settings/settings.nav';

export default defineNavigation({
  items: [
    {
      id: 'settings.numbering',
      area: settingsArea,
      order: 30,
      link: linkOptions({ to: '/settings/numbering' }),
      label: 'settings:nav.numbering',
      icon: Hash,
    },
  ],
});
