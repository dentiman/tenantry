import { z } from 'zod';
import { defineJob } from '../job-definition';

/**
 * Щоденна чистка протермінованих refresh-токенів (cron у воркері).
 * System-scope: крос-tenant, БД — через SystemPrismaService (BYPASSRLS).
 */
export const authCleanupExpiredTokensJob = defineJob('auth.cleanup-expired-tokens', z.object({}), {
  cron: '0 3 * * *',
  retryLimit: 1,
  scope: 'system',
});
