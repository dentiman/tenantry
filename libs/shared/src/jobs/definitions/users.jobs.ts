import { z } from 'zod';
import { defineTenantJob } from '../job-definition';

/** Подія реєстрації користувача (диспатчиться з адмінського create user); споживає notifications */
export const userRegisteredJob = defineTenantJob(
  'users.user-registered',
  z.object({
    userId: z.uuid(),
    email: z.email(),
  }),
);
