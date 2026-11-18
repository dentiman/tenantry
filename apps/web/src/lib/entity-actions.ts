/**
 * Дії над сутністю, у якої немає сторінки (docs/user-operations.md: ціль сповіщення
 * `user_operation` — завантажити результат, а не перейти кудись). Доповнює `entity-routes.ts`:
 * той відповідає «куди вести», цей — «що зробити».
 *
 * Реєстр, а не імпорт: сповіщення (platform) не можуть знати фіч. Дію реєструє composition root
 * (`main.tsx`) від імені модуля-власника. Невідомий kind — легальний стан: картка просто не
 * клікабельна.
 */
type EntityAction = (id: string) => void;

const ACTIONS = new Map<string, EntityAction>();

export function registerEntityAction(kind: string, action: EntityAction): void {
  ACTIONS.set(kind, action);
}

export function entityAction(kind: string): EntityAction | null {
  return ACTIONS.get(kind) ?? null;
}
