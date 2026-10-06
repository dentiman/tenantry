import { defineSlot } from '../../lib/slots';

/** Картки вкладки «Огляд» на сторінці клієнта — над картками самого клієнта */
export const customerOverviewCards = defineSlot<{ customerId: string; customerName: string }>(
  'customers.overview-cards',
);

/**
 * Вкладки картки кастомера від фіч — `TabsTrigger` із `Link` на власний дочірній маршрут фічі
 * під `customerDetailRoute` (календар → `events`). Значення `value` вкладки = сегмент шляху:
 * за ним лейаут підсвічує активну (docs/modules.md §7.4)
 */
export const customerDetailTabs = defineSlot<{ customerId: string }>('customers.detail-tabs');
