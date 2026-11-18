import type { z } from 'zod';

export interface UserOperationTypeDef {
  /** Вхідні параметри: сервіс валідує на старті, воркер — ще раз перед роботою */
  readonly params: z.ZodType;
  /** Ключі кроків, якщо тип з них складається; без кроків — лише відсоток */
  readonly steps?: readonly string[];
}

/**
 * Типи операцій модуля-власника (той самий прийом, що `defineNotificationTypes`,
 * docs/modules.md §7.1): механізм дає модуль `user-operations`, визначення живуть у контрактах
 * власника (`customer/customer.operations.ts`), збирає їх root `user-operation-types.ts`.
 */
export function defineUserOperationTypes<const T extends Record<string, UserOperationTypeDef>>(
  types: T,
): T {
  return types;
}
