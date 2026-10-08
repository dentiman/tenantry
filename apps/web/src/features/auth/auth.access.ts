import type { UserResponse } from '@saas-skeleton/contracts';

/**
 * Хто може відкрити сторінку — оголошує РОУТ у `staticData.access` (`router.tsx`). З цього одного
 * джерела виводяться гейт переходу (`requireAuth`), видимість пунктів меню і розділів рейлу
 * (`libs/ui/src/navigation`). Зараз це ролі й прапорці фіч інсталяції; дозволи (RBAC) і
 * entitlements тенанта розширюють цей тип і `isAllowed`, а не меню чи роути.
 */
export interface RouteAccess {
  /** Порожній/відсутній — відкрито всім залогіненим */
  roles?: readonly UserResponse['role'][];
  /** Прапорець `features.<feature>` з `GET /settings/bootstrap` (`features.ai`) */
  feature?: string;
}

/**
 * `features` — мапа з bootstrap. `undefined` означає «ще невідомо» (холодний старт або
 * синхронний гейт переходу, якому bootstrap недоступний): тоді прапорець НЕ перевіряється —
 * сторінка вимкненої фічі однаково отримує 403 від бекенда і показує порожній стан, а рейл
 * перемальовується, щойно bootstrap приземлиться.
 */
export function isAllowed(
  access: unknown,
  user: UserResponse | null,
  features?: Readonly<Record<string, boolean>>,
): boolean {
  const { roles, feature } = (access ?? {}) as RouteAccess;
  if (feature && features && features[feature] !== true) return false;
  if (!roles) return true;
  return user !== null && roles.includes(user.role);
}
