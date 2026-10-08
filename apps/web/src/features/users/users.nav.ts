import { linkOptions } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { workspaceArea } from '../../app-shell/workspace.nav';

export default defineNavigation({
  items: [
    {
      id: 'users',
      area: workspaceArea,
      order: 20,
      link: linkOptions({ to: '/workspace/users' }),
      label: 'layout:nav.users',
      icon: Users,
    },
  ],
});
