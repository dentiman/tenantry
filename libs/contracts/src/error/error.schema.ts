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
  'CHANNEL_WINDOW_CLOSED', // 422 — вікно вільного тексту каналу закрите (CHAT-2b); фронт пояснює правило
  'TOO_MANY_REQUESTS', // 429 — обмеження частоти (AUTH-0); заголовок Retry-After
  'INTERNAL_ERROR', // 500 — деталі тільки в логах
  'SERVICE_UNAVAILABLE', // 503 — БД/залежність недоступна, можна ретраїти
]);

export const FieldErrorSchema = z.object({
  /** Шлях до поля як у request-схемі, вкладеність через крапку: "email", "address.city" */
  field: z.string(),
  /** Англійська діагностика — фронт показує лише як fallback, коли немає перекладу під `code` */
  message: z.string(),
  /** Машинний код (Zod issue code, "already_exists"...) — фронт перекладає під `errors:fieldErrors.<code>` */
  code: z.string().optional(),
  /** Параметри для інтерполяції в перекладене повідомлення (наприклад, мінімальна довжина) */
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: ApiErrorCodeSchema,
  message: z.string(),
  fieldErrors: z.array(FieldErrorSchema).optional(),
  /** id запиту з pino-http — для кореляції з логами */
  requestId: z.string().optional(),
});
