import { linkOptions } from '@tanstack/react-router';
import { MessagesSquare } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { ChatSidebar } from './chat-sidebar';

export const chatArea = defineArea({
  id: 'chat',
  prefix: linkOptions({ to: '/chat' }).to,
  label: 'layout:areas.chat',
  icon: MessagesSquare,
  order: 30,
  panel: ChatSidebar,
});

export default defineNavigation({ areas: [chatArea] });
