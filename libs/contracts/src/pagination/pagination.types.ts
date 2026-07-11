import type { z } from 'zod';
import type { PaginationQuerySchema, paginatedResponseSchema } from './pagination.schema';

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginatedResponse<T extends z.ZodType> = z.infer<
  ReturnType<typeof paginatedResponseSchema<T>>
>;
