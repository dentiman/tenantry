import type { UserResponse } from '@saas-skeleton/contracts';

/**
 * Хто може відкрити сторінку — оголошує РОУТ у `staticData.access` (`router.tsx`). З цього одного
 * джерела виводяться гейт переходу (`requireAuth`), видимість пунктів меню і розділів рейлу
 * (`libs/ui/src/navigation`). Зараз це лише ролі; дозволи (RBAC) і entitlements тенанта
 * розширюють цей тип і `isAllowed`, а не меню чи роути.
 */
export interface RouteAccess {
  /** Порожній/відсутній — відкрито всім залогіненим */
  roles?: readonly UserResponse['role'][];
}

export function isAllowed(access: unknown, user: UserResponse | null): boolean {
  const { roles } = (access ?? {}) as RouteAccess;
  if (!roles) return true;
  return user !== null && roles.includes(user.role);
}
