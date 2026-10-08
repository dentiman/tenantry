import { linkOptions } from '@tanstack/react-router';
import { LayoutDashboard } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { workspaceArea } from '../../app-shell/workspace.nav';

export default defineNavigation({
  items: [
    {
      id: 'dashboard',
      area: workspaceArea,
      order: 10,
      link: linkOptions({ to: '/workspace' }),
      label: 'layout:nav.dashboard',
      icon: LayoutDashboard,
      match: 'exact',
    },
  ],
});
