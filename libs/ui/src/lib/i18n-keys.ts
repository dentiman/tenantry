/**
 * Помічники для ключів перекладу під типізованим `t()` (docs/i18n-plan.md).
 *
 * У застосунку, що оголосив `CustomTypeOptions` (apps/web), `t('…')` приймає лише ключі, які
 * справді є в ресурсах: опечатка — помилка `tsc`. Ключ, зібраний у рантаймі, під це правило
 * не підпадає, і для нього є рівно два шляхи.
 */

/**
 * Ключ, відомий лише в рантаймі: прийшов із реєстру (навігація, типи сповіщень і активностей,
 * палітри тем) або з відповіді сервера. Компілятор перевірити його не може, тому наявність
 * текстів тримає тест реєстрів (`registry-texts.test.ts`), а не типи.
 *
 * `t(...runtimeKey(area.label))` — явна позначка «цей ключ свідомо поза перевіркою», яку легко
 * знайти пошуком. `defaultValue` дорівнює ключу, тож поведінка та сама, що без нього: якщо
 * тексту немає, i18next повертає сам ключ.
 */
export function runtimeKey<TOptions extends Record<string, unknown> = Record<never, never>>(
  key: string,
  options?: TOptions,
): [key: string, options: TOptions & { defaultValue: string }] {
  return [key, { ...options, defaultValue: key } as TOptions & { defaultValue: string }];
}

/**
 * `toLowerCase()` зі збереженням літерального типу: `'ACCEPTED' | 'DECLINED'` →
 * `'accepted' | 'declined'`. Дає зібрати ключ із enum-а так, щоб компілятор його ПЕРЕВІРИВ:
 * `t(\`status.${lowercase(status)}\`)`. Звичайний `toLowerCase()` повертає `string`, і ключ
 * перестає бути перевірюваним.
 */
export function lowercase<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

/**
 * Те саме, що `runtimeKey`, але для `<Trans i18nKey>`: у `Trans` немає перевантаження з
 * `defaultValue`, тож рантайм-ключ можна передати лише зведенням типу. Зведення живе тут, в
 * одному місці, а не розкидане по компонентах.
 */
export function runtimeTransKey(key: string): never {
  return key as never;
}
