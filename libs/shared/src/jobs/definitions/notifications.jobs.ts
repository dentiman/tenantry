import { z } from 'zod';
import { defineJob } from '../job-definition';

/**
 * Welcome-лист новому користувачу. Ставиться хендлером події
 * users.user-registered (fan-out), НЕ напряму з API.
 */
export const welcomeEmailJob = defineJob(
  'notifications.welcome-email',
  z.object({
    userId: z.uuid(),
    email: z.email(),
  }),
);
