import { linkOptions } from '@tanstack/react-router';
import { BotIcon } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { settingsArea } from '../settings/settings.nav';

export default defineNavigation({
  items: [
    {
      id: 'settings.ai',
      area: settingsArea,
      order: 40,
      link: linkOptions({ to: '/settings/ai' }),
      label: 'settings:nav.ai',
      icon: BotIcon,
    },
  ],
});
