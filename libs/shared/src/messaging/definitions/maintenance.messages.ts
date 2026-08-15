import { z } from 'zod';
import { defineCommand } from '../message-definition';

/** Щоденна чистка протермінованих refresh-токенів */
export const cleanupExpiredTokensCommand = defineCommand(
  'auth.cleanup-expired-tokens',
  z.object({}),
  { scope: 'system' },
);

/**
 * Чистка маркерів ідемпотентності. Без неї processed_jobs росте вічно (розрив §2.6).
 * Горизонт свідомо БІЛЬШИЙ за retention pg-boss (~7 днів): маркер мусить пережити
 * останній можливий retry свого job-а, інакше видалення маркера відкриє шлях
 * повторному застосуванню ефекту.
 */
export const cleanupProcessedJobsCommand = defineCommand(
  'maintenance.cleanup-processed-jobs',
  z.object({}),
  { scope: 'system' },
);
