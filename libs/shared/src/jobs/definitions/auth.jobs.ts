import { z } from 'zod';
import { defineJob } from '../job-definition';

/** Щоденна чистка протермінованих refresh-токенів (cron у воркері) */
export const authCleanupExpiredTokensJob = defineJob('auth.cleanup-expired-tokens', z.object({}), {
  cron: '0 3 * * *',
  retryLimit: 1,
});
