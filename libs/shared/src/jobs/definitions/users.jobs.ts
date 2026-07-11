import { z } from 'zod';
import { defineJob } from '../job-definition';

/** Подія реєстрації користувача; у фазі 2.3 її споживатиме notifications */
export const userRegisteredJob = defineJob(
  'users.user-registered',
  z.object({
    userId: z.uuid(),
    email: z.email(),
  }),
);
