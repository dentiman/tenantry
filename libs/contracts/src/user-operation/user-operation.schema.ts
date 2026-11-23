import { z } from 'zod';
import { StepStatusSchema } from '../progress/step.schema';

/**
 * Операція користувача (docs/user-operations.md): ресурс за відповіддю `202` для роботи, що
 * живе довше за один запит. Належить ініціатору — і лише він її бачить (рішення 2026-11-17).
 */
export const UserOperationStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
]);

/** Фінальні стани: після них операція не змінюється (guarded transitions на сервері) */
export const FINAL_USER_OPERATION_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELED'] as const;

export const UserOperationStepSchema = z.object({
  /** Ключ кроку; підпис фронт бере з `userOperations.<type>.steps.<key>` */
  key: z.string().min(1),
  status: StepStatusSchema,
  current: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
});

/**
 * Машинні коди помилок операції. Текст для людини — на фронті через i18next, як і `ApiError.code`.
 * `STALLED` ставить sweeper, коли операція перестала звітувати; `INTERNAL` — будь-яка
 * непередбачена помилка після вичерпання повторів.
 */
export const UserOperationErrorCodeSchema = z.enum(['STALLED', 'INVALID_PARAMS', 'INTERNAL']);

export const UserOperationResponseSchema = z.object({
  id: z.uuid(),
  /** Код типу із закритого реєстру (`USER_OPERATION_TYPES`) */
  type: z.string(),
  /** Назва від типу операції (для експорту — імʼя файлу): дані, не перекладений текст */
  title: z.string(),
  status: UserOperationStatusSchema,
  /** null — прогрес невизначений (або ще не почався) */
  progress: z.object({ current: z.number().int(), total: z.number().int() }).nullable(),
  steps: z.array(UserOperationStepSchema).nullable(),
  /** Монотонний лічильник змін: сокет-подія несе його, клієнт перечитує, лише коли він новіший */
  revision: z.number().int(),
  /** Підсумок типу операції (кількість рядків, назва файлу) */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Є файл результату — його посилання видає `GET /user-operations/:id/result-url` */
  hasResultFile: z.boolean(),
  errorCode: UserOperationErrorCodeSchema.nullable(),
  cancelRequested: z.boolean(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export const UserOperationListQuerySchema = z.object({
  /** `true` — лише QUEUED і RUNNING (лоток після перезавантаження сторінки) */
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const UserOperationListResponseSchema = z.object({
  items: z.array(UserOperationResponseSchema),
});

export const UserOperationResultUrlResponseSchema = z.object({
  url: z.url(),
  filename: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Скільки зберігається завершена операція і файл її результату (рішення 2026-11-17) */
export const USER_OPERATION_RETENTION_DAYS = 30;
/** Операція без оновлень довше за це — зависла; sweeper ставить FAILED/STALLED */
export const USER_OPERATION_STALL_MINUTES = 15;
