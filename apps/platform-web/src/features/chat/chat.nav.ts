import { linkOptions } from '@tanstack/react-router';
import { Webhook } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { operationsArea } from '../messaging/messaging.nav';

export default defineNavigation({
  items: [
    {
      id: 'operations.channel-events',
      area: operationsArea,
      order: 30,
      link: linkOptions({ to: '/operations/channel-events' }),
      label: 'layout:nav.channelEvents',
      icon: Webhook,
    },
  ],
});
