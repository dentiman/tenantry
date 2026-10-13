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
  | { to: '/workspace/users/$userId'; params: { userId: string } }
  | { to: '/workspace/customers/$customerId'; params: { customerId: string } }
  | { to: '/calendar/events/$eventId'; params: { eventId: string } }
  | { to: '/chat/$conversationId'; params: { conversationId: string } };

const ENTITY_LINKS: Record<string, (id: string) => EntityLink> = {
  user: (id) => ({ to: '/workspace/users/$userId', params: { userId: id } }),
  customer: (id) => ({ to: '/workspace/customers/$customerId', params: { customerId: id } }),
  // Подія відкривається ПОВЕРХ сітки того тижня, у якому лежить — тому окремий
  // роут, а не `?eventId=` (docs/calendar.md §11.1)
  calendar_event: (id) => ({ to: '/calendar/events/$eventId', params: { eventId: id } }),
  conversation: (id) => ({ to: '/chat/$conversationId', params: { conversationId: id } }),
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
