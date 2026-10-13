import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity-definition';
import { defineNotificationTypes } from '../notification/notification-definition';

/**
 * Сповіщення чату (docs/chat.md §4.11). Тексти — у неймспейсі `chat`, ключі `notifications.*`.
 *
 * Одна подія, колапс по розмові: доки отримувач не прочитав, нові репліки доливаються в той
 * самий рядок (`groupKey = conversation:<id>`), тож десять повідомлень — це «10 нових», а не
 * десять рядків. `label` у payload-і рахується під отримувача (назва розмови або співрозмовники),
 * а `preview` — той самий зріз тексту, що й прев'ю у списку розмов: рядок інбокса самодостатній
 * і не робить join на живі таблиці.
 */
export const CHAT_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'chat', prefix: 'notifications' },
  {
    'chat.message_received': {
      payload: z.object({
        conversation: EntityRefSchema, // kind: 'conversation'
        preview: z.string(),
      }),
      category: 'chat',
      defaultEnabled: true,
      muteable: true,
      subject: 'conversation',
    },
    // CHAT-2b: вхідне від клієнта — призначеному агентові. Свій тип, а не `chat.message_received`:
    // той називає актора-користувача («X написав»), а тут пише контакт, якого серед користувачів
    // немає. Колапсується на тому самому ключі, а прочитання розмови гасить обидва типи
    'chat.customer_message_received': {
      payload: z.object({
        conversation: EntityRefSchema, // kind: 'conversation'; label — імʼя клієнта або номер
        preview: z.string(),
      }),
      category: 'chat',
      defaultEnabled: true,
      muteable: true,
      subject: 'conversation',
    },
  },
);
