import type { z } from 'zod';
import type {
  PaginationQuerySchema,
  paginatedResponseSchema,
  CursorQuerySchema,
  cursorResponseSchema,
} from './pagination.schema';

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginatedResponse<T extends z.ZodType> = z.infer<
  ReturnType<typeof paginatedResponseSchema<T>>
>;
export type CursorQuery = z.infer<typeof CursorQuerySchema>;
export type CursorResponse<T extends z.ZodType> = z.infer<
  ReturnType<typeof cursorResponseSchema<T>>
>;
