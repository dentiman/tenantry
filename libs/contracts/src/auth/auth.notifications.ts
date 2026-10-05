import { z } from 'zod';
import { defineNotificationTypes } from '../notification/notification-definition';

/** Безпекові сповіщення (AUTH-1): вимкнути їх не можна. Тексти платформні */
export const AUTH_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'notifications' },
  {
    // Обидва поля nullable: заголовка User-Agent може не бути взагалі (curl, старий
    // клієнт), а ip — за проксі, якому ми не довіряємо. Рядок інбокса мусить
    // рендеритись і без них: «новий вхід» сам по собі вже сигнал
    'auth.new_device': {
      payload: z.object({
        deviceLabel: z.string().nullable(),
        ip: z.string().nullable(),
      }),
      category: 'security',
      defaultEnabled: true,
      muteable: false,
    },
    'auth.session_reuse_detected': {
      payload: z.object({
        deviceLabel: z.string().nullable(),
      }),
      category: 'security',
      defaultEnabled: true,
      muteable: false,
    },
  },
);
