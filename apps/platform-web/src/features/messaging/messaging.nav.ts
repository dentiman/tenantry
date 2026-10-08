import { linkOptions } from '@tanstack/react-router';
import { Activity, LayoutGrid, ListChecks } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';

/**
 * Area «Operations» — машинерія системи (моніторинг черг). Росте на EDA-2 (DLQ, replay, лаг
 * черг) — той самий аргумент, яким Settings у web стали окремою area.
 */
export const operationsArea = defineArea({
  id: 'operations',
  prefix: linkOptions({ to: '/operations' }).to,
  label: 'layout:areas.operations',
  icon: Activity,
  order: 20,
  panel: 'menu',
});

export default defineNavigation({
  areas: [operationsArea],
  items: [
    {
      id: 'operations.jobs',
      area: operationsArea,
      order: 10,
      link: linkOptions({ to: '/operations/jobs' }),
      label: 'layout:nav.jobs',
      icon: ListChecks,
    },
    {
      id: 'operations.queues',
      area: operationsArea,
      order: 20,
      link: linkOptions({ to: '/operations/queues' }),
      label: 'layout:nav.queues',
      icon: LayoutGrid,
    },
  ],
});
