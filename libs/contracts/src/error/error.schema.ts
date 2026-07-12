import { z } from 'zod';

/**
 * Машинні коди помилок — закрита множина, фронт світчиться по code, не по message.
 * statusCode дублює HTTP-статус, щоб envelope був самодостатнім (логи, черги, тости).
 */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR', // 400, є fieldErrors
  'BAD_REQUEST', // 400 без прив'язки до полів
  'UNAUTHORIZED', // 401
  'FORBIDDEN', // 403
  'NOT_FOUND', // 404
  'CONFLICT', // 409 (унікальність — з fieldErrors, якщо відоме поле)
  'INTERNAL_ERROR', // 500 — деталі тільки в логах
  'SERVICE_UNAVAILABLE', // 503 — БД/залежність недоступна, можна ретраїти
]);

export const FieldErrorSchema = z.object({
  /** Шлях до поля як у request-схемі, вкладеність через крапку: "email", "address.city" */
  field: z.string(),
  message: z.string(),
});

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: ApiErrorCodeSchema,
  message: z.string(),
  fieldErrors: z.array(FieldErrorSchema).optional(),
  /** id запиту з pino-http — для кореляції з логами */
  requestId: z.string().optional(),
});
