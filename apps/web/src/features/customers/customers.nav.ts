import { linkOptions } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { defineMenu, defineNavigation } from '@saas-skeleton/ui/navigation';
import { workspaceArea } from '../../app-shell/workspace.nav';

export const customerDetailMenu = defineMenu({ id: 'customers.detail' });

export default defineNavigation({
  menus: [customerDetailMenu],
  menuItems: [
    {
      id: 'customers.overview',
      menu: customerDetailMenu,
      order: 10,
      link: linkOptions({
        from: '/workspace/customers/$customerId',
        to: '/workspace/customers/$customerId',
        params: true,
      }),
      label: 'customers:detail.tabs.overview',
      match: 'exact',
    },
    {
      id: 'customers.contacts',
      menu: customerDetailMenu,
      order: 20,
      link: linkOptions({
        from: '/workspace/customers/$customerId',
        to: '/workspace/customers/$customerId/contacts',
        params: true,
      }),
      label: 'customers:detail.tabs.contacts',
    },
  ],
  items: [
    {
      id: 'customers',
      area: workspaceArea,
      order: 30,
      link: linkOptions({ to: '/workspace/customers' }),
      label: 'layout:nav.customers',
      icon: Building2,
    },
  ],
});
