import { z } from 'zod';

/**
 * Стан кроку — єдиний фіксований enum «прогресу списком етапів» (docs/user-operations.md §4).
 * Інфраструктурний, без домену: той самий тип малює `StepProgress` у `libs/ui` для клієнтської
 * черги завантажень і приходить із сервера в `UserOperation.steps`.
 */
export const StepStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof StepStatusSchema>;
