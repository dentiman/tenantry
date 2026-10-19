import { linkOptions } from '@tanstack/react-router';
import { ReceiptText } from 'lucide-react';
import { defineNavigation } from '@saas-skeleton/ui/navigation';
import { workspaceArea } from '../../app-shell/workspace.nav';

export default defineNavigation({
  items: [
    {
      id: 'invoices-demo',
      area: workspaceArea,
      // Одразу після Customers (30)
      order: 40,
      link: linkOptions({ to: '/workspace/invoices' }),
      label: 'invoices-demo:nav',
      icon: ReceiptText,
    },
  ],
});
