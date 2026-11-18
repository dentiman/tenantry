import type { UserOperationTypeDef } from './user-operation/user-operation-definition';
import { CUSTOMER_OPERATIONS } from './customer/customer.operations';

/**
 * Composition root типів операцій користувача (docs/modules.md §7.1): єдине місце, що знає,
 * які модулі мають фонові операції. Прибираючи фічу з форку, прибери її рядок тут.
 */
export const USER_OPERATION_DEFINITIONS = {
  ...CUSTOMER_OPERATIONS,
} satisfies Record<string, UserOperationTypeDef>;

export type UserOperationType = Extract<keyof typeof USER_OPERATION_DEFINITIONS, string>;

export const USER_OPERATION_TYPES = Object.keys(
  USER_OPERATION_DEFINITIONS,
) as readonly UserOperationType[];
