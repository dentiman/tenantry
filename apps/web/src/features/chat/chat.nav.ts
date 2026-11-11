import { linkOptions } from '@tanstack/react-router';
import { MessageSquareShare, MessagesSquare } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { settingsArea } from '../settings/settings.nav';
import { lazyComponent } from '@saas-skeleton/ui/lib/lazy';

/** Друга колонка — окремий чанк: в головний чанк area лишає лише метадані (docs/frontend/lazy-loading.md) */
const ChatSidebar = lazyComponent(() => import('./chat-sidebar'), 'ChatSidebar');

export const chatArea = defineArea({
  id: 'chat',
  prefix: linkOptions({ to: '/chat' }).to,
  label: 'layout:areas.chat',
  icon: MessagesSquare,
  order: 20,
  panel: ChatSidebar,
});

export default defineNavigation({
  areas: [chatArea],
  items: [
    {
      id: 'settings.messaging',
      area: settingsArea,
      order: 30,
      link: linkOptions({ to: '/settings/messaging' }),
      label: 'chat:settings.nav',
      icon: MessageSquareShare,
    },
  ],
});
