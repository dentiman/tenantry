import { z } from 'zod';
import { EntityRefSchema, defineActivityTypes } from '../activity/activity-definition';

/** Відправлений лист — журнал юзера показує, що і на яку адресу пішло. Тексти платформні */
export const AUTH_ACTIVITIES = defineActivityTypes(
  { ns: 'activities' },
  {
    'email.sent': {
      payload: z.object({
        template: z.string(), // 'welcome' — ключ у i18n фронта
        recipient: EntityRefSchema,
        email: z.email(), // снапшот адреси, на яку реально пішов лист
      }),
    },
  },
);
