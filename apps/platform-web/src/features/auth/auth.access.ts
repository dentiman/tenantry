/**
 * Доступ до сторінки оголошує роут у `staticData.access` — дзеркало `apps/web`
 * (`features/auth/auth.access.ts`): з одного джерела виводяться гейт і видимість пунктів меню.
 * Усі оператори рівні (в `PlatformUserResponse` немає ролі), тож обмежень поки немає, а тип
 * порожній навмисно: коли зʼявляться ролі чи дозволи, їх додають сюди й у `isAllowed`.
 */
export type RouteAccess = Record<never, never>;

export function isAllowed(_access: unknown): boolean {
  return true;
}
