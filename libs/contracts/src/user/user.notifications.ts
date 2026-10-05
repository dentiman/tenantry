import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity-definition';
import { defineNotificationTypes } from '../notification/notification-definition';

/** Сповіщення про юзерів організації. Тексти платформні — у неймспейсі `notifications` */
export const USER_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'notifications' },
  {
    'user.created': {
      payload: z.object({ user: EntityRefSchema }),
      category: 'organization',
      defaultEnabled: true,
      muteable: true,
      subject: 'user',
    },
    // Ні пароля, ні хеша, ні довжини — тільки факт; хто змінив, видно з actorLabel
    'user.password_changed': {
      payload: z.object({}),
      category: 'security',
      defaultEnabled: true,
      muteable: false,
    },
    'user.welcome': {
      payload: z.object({ tenant: z.string().min(1) }),
      category: 'organization',
      defaultEnabled: true,
      muteable: true,
    },
  },
);
