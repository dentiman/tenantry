import { z } from 'zod';
import { EntityRefSchema, defineActivityTypes } from '../activity/activity-definition';

/**
 * Типи активності кастомерів (docs/customers.md §9). Окремі типи замість одного
 * `customer.updated` із діффом — та сама доктрина, що в юзерах: журнал читають люди, і «хто
 * заархівував клієнта» мусить фільтруватися по type. Редагування другорядних полів у журнал
 * не потрапляє взагалі.
 *
 * Тексти — у неймспейсі `customers`, ключ `activity.<тип>`.
 */
export const CUSTOMER_ACTIVITIES = defineActivityTypes(
  { ns: 'customers', prefix: 'activity' },
  {
    'customer.created': {
      workspace: true,
      payload: z.object({
        customer: EntityRefSchema, // kind: 'customer'
      }),
    },
    'customer.archived': {
      workspace: true,
      payload: z.object({
        customer: EntityRefSchema,
      }),
    },
    'customer.restored': {
      workspace: true,
      payload: z.object({
        customer: EntityRefSchema,
        status: z.enum(['ACTIVE', 'INACTIVE']), // куди саме повернули з архіву
      }),
    },
    'customer.owner_changed': {
      workspace: true,
      payload: z.object({
        customer: EntityRefSchema,
        // null з обох боків легальний: «нічий» — робочий стан, а не помилка
        previousOwner: EntityRefSchema.nullable(),
        owner: EntityRefSchema.nullable(),
      }),
      // Зняття відповідального — не «призначення на null»: у людини це окрема фраза
      textVariant: (payload) => (payload.owner === null ? 'customer.owner_cleared' : undefined),
    },
    'customer.deleted': {
      workspace: true,
      payload: z.object({
        // Лінк лишається на неіснуючий id, і це нормально: журнал переживає сутність,
        // саме тому label — снапшот, а не join
        customer: EntityRefSchema,
      }),
    },
  },
);
