import { defineSlot } from '../lib/slots';

/** Картки вкладки «Огляд» на сторінці клієнта — над картками самого клієнта */
export const customerOverviewCards = defineSlot<{ customerId: string; customerName: string }>(
  'customers.overview-cards',
);
