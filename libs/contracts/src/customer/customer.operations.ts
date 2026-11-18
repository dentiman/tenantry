import { z } from 'zod';
import { defineUserOperationTypes } from '../user-operation/user-operation-definition';
import { CustomerQuerySchema } from './customer.schema';

/** Скільки клієнтів максимум в одному експорті: CSV будується в памʼяті воркера */
export const CUSTOMER_EXPORT_MAX_ROWS = 50_000;

/**
 * Фільтри експорту — ті самі, що в списку клієнтів, без пагінації: експорт бере ВСІ збіги,
 * а не поточну сторінку (openspec: customers/export).
 */
export const ExportCustomersSchema = CustomerQuerySchema.omit({ page: true, limit: true });
export type ExportCustomers = z.infer<typeof ExportCustomersSchema>;

/** Операції модуля клієнтів; збирає root `user-operation-types.ts` */
export const CUSTOMER_OPERATIONS = defineUserOperationTypes({
  'customers.export': { params: ExportCustomersSchema },
});
