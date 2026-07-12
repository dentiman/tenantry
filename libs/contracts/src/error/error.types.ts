import type { z } from 'zod';
import type { ApiErrorCodeSchema, ApiErrorSchema, FieldErrorSchema } from './error.schema';

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type FieldError = z.infer<typeof FieldErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
