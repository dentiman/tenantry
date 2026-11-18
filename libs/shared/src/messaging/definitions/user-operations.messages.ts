import { z } from 'zod';
import { defineCommand } from '../message-definition';

/**
 * Зависла операція (RUNNING без heartbeat довше за поріг) → FAILED/STALLED. Гарантує, що
 * операція не лишиться «виконується» назавжди, навіть якщо job вичерпав повтори й ліг у `dlq`.
 * System-scope: по всіх тенантах.
 */
export const sweepStalledUserOperationsCommand = defineCommand(
  'user-operations.sweep-stalled',
  z.object({}),
  { scope: 'system' },
);

/** Завершені операції старші за 30 днів — разом із файлами результату. System-scope */
export const purgeFinishedUserOperationsCommand = defineCommand(
  'user-operations.purge-finished',
  z.object({}),
  { scope: 'system' },
);
