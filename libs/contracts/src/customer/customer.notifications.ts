import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity-definition';
import { defineNotificationTypes } from '../notification/notification-definition';

/** Сповіщення кастомерів. Тексти — у неймспейсі `customers`, ключі `notifications.*` */
export const CUSTOMER_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'customers', prefix: 'notifications' },
  {
    'customer.assigned': {
      payload: z.object({ customer: EntityRefSchema }),
      category: 'organization',
      defaultEnabled: true,
      muteable: true,
      subject: 'customer',
    },
  },
);
