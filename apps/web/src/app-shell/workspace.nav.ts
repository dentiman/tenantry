import { linkOptions } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «Workspace» — робоча частина застосунку; належить самому шелу. Її пункти (Dashboard,
 * Users, Customers) оголошують свої модулі у власних `*.nav.ts`.
 */
export const workspaceArea = defineArea({
  id: 'workspace',
  prefix: linkOptions({ to: '/workspace' }).to,
  label: 'layout:areas.workspace',
  icon: LayoutGrid,
  order: 10,
  panel: 'menu',
});

export default defineNavigation({ areas: [workspaceArea] });
