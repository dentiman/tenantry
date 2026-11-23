import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity-definition';
import { defineNotificationTypes } from '../notification/notification-definition';
import { UserOperationErrorCodeSchema } from './user-operation.schema';

/**
 * Завершення операції (docs/user-operations.md §5, крок 7). `operation.label` — назва, яку дає
 * тип операції (для експорту — імʼя файлу), тобто дані, а не перекладений текст. Скасована
 * операція не сповіщає: користувач щойно скасував її сам. Тексти — неймспейс `user-operations`.
 */
export const USER_OPERATION_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'user-operations', prefix: 'notifications' },
  {
    'user_operation.succeeded': {
      payload: z.object({ operation: EntityRefSchema, type: z.string() }),
      category: 'organization',
      defaultEnabled: true,
      // Людина сама запустила роботу й чекає на неї — вимикати нема чого
      muteable: false,
      subject: 'operation',
    },
    'user_operation.failed': {
      payload: z.object({
        operation: EntityRefSchema,
        type: z.string(),
        errorCode: UserOperationErrorCodeSchema,
      }),
      category: 'organization',
      defaultEnabled: true,
      muteable: false,
      subject: 'operation',
    },
  },
);
