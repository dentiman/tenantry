import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const SortOrderSchema = z.enum(['asc', 'desc']);

/**
 * page/limit + sortBy (whitelist полів сутності, закритий enum — потрапляє
 * в Swagger) + sortOrder. Без sortBy сортує серверний дефолт (endpoint-специфічний).
 */
export function listQuerySchema<const Fields extends [string, ...string[]]>(
  sortableFields: Fields,
): z.ZodObject<{
  page: z.ZodDefault<z.ZodCoercedNumber>;
  limit: z.ZodDefault<z.ZodCoercedNumber>;
  sortBy: z.ZodOptional<z.ZodEnum<{ [K in Fields[number]]: K }>>;
  sortOrder: z.ZodOptional<z.ZodDefault<typeof SortOrderSchema>>;
}> {
  return PaginationQuerySchema.extend({
    sortBy: z.enum(sortableFields).optional(),
    sortOrder: SortOrderSchema.default('asc').optional(),
  });
}

export function paginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  total: z.ZodNumber;
  page: z.ZodNumber;
  limit: z.ZodNumber;
  totalPages: z.ZodNumber;
}> {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  });
}
