import { linkOptions } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «Tenants» — клієнти платформи. Один пункт — це легально: розділ не вимагає підменю
 * (наповниться на MT-4: оператори, сегменти тенантів).
 */
export const tenantsArea = defineArea({
  id: 'tenants',
  prefix: linkOptions({ to: '/tenants' }).to,
  label: 'layout:areas.tenants',
  icon: Building2,
  order: 10,
  panel: 'menu',
});

export default defineNavigation({
  areas: [tenantsArea],
  items: [
    {
      id: 'tenants.all',
      area: tenantsArea,
      order: 10,
      link: linkOptions({ to: '/tenants' }),
      label: 'layout:nav.allTenants',
      icon: Building2,
      match: 'exact',
    },
  ],
});
