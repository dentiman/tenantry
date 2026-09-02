/**
 * Реєстр «сутність → сторінка». Єдине місце, де фронт знає, куди веде
 * `{kind, id}` з payload-у сповіщення чи активності; бекенд про роути не знає
 * нічого і слати їх не має права (інакше UI-навігація переїхала б у БД).
 *
 * Значення — не рядок, а пара `{ to, params }` реального роуту застосунку:
 * типізовані `<Link>` TanStack Router-а не приймуть довільний шлях, і мертве
 * посилання ловиться компіляцією. Union росте рядком на кожну нову сутність.
 *
 * Невідомий kind — легальний стан (фронт може бути старіший за бекенд): виклик
 * повертає null, і місце виклику рендерить сам label без посилання.
 */
export type EntityLink =
  | { to: '/users/$userId'; params: { userId: string } }
  | { to: '/customers/$customerId'; params: { customerId: string } };

const ENTITY_LINKS: Record<string, (id: string) => EntityLink> = {
  user: (id) => ({ to: '/users/$userId', params: { userId: id } }),
  customer: (id) => ({ to: '/customers/$customerId', params: { customerId: id } }),
};

export function entityLink(kind: string, id: string): EntityLink | null {
  return ENTITY_LINKS[kind]?.(id) ?? null;
}

/**
 * Розгорнутий шлях — ТІЛЬКИ для порівняння з поточним `location.pathname`
 * («ми вже на цій сторінці?»). Для навігації і `<Link>` використовується сама
 * пара `{ to, params }`, щоб роутер лишався типізованим.
 */
export function entityPath(link: EntityLink): string {
  return Object.entries(link.params).reduce<string>(
    (path, [key, value]) => path.replace(`$${key}`, value),
    link.to,
  );
}
