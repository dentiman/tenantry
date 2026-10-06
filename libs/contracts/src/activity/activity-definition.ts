import { z } from 'zod';

/**
 * Референс на сутність усередині payload: id — для майбутнього лінка на сторінку,
 * label — СНАПШОТ назви на момент події (сутність можуть перейменувати/видалити,
 * фід рендериться без join-ів на живі таблиці).
 */
export const EntityRefSchema = z.object({
  kind: z.string().min(1),
  id: z.uuid(),
  label: z.string(),
});

/**
 * Де фронтенд бере тексти групи типів (docs/modules.md §7.1): i18next-неймспейс
 * модуля-власника і, за потреби, префікс ключів у ньому. Бекенд текстів не має — він шле
 * тип і payload; це лише адреса, за якою їх шукати.
 */
export interface TypeTexts {
  readonly ns: string;
  readonly prefix?: string;
}

/** `calendar:activity.` / `activities:` — основа ключа, до якої дописується тип */
export function textKeyBase(texts: TypeTexts): string {
  return texts.prefix ? `${texts.ns}:${texts.prefix}.` : `${texts.ns}:`;
}

export interface ActivityTypeDef {
  /** Recorder валідує на записі (fail fast — невалідний payload не потрапить у append-only таблицю) */
  readonly payload: z.ZodType;
  /**
   * Інший ключ тексту для того самого типу, коли фраза залежить від payload-а
   * («зняв відповідального» замість «призначив null»). Тип один — журнал фільтрується по
   * ньому, розгалужується лише текст. Повертає ключ відносно `texts` або `undefined`.
   */
  readonly textVariant?: (payload: Record<string, unknown>) => string | undefined;
}

export type DefinedTypes<T, Extra> = { readonly [K in keyof T]: T[K] & Extra };

/**
 * Типи активностей модуля-власника. Модуль `activities` дає лише механізм; визначення
 * живуть у контрактах власника (`calendar/calendar.activities.ts`), а збирає їх root
 * `libs/contracts/src/activity-types.ts`.
 */
export function defineActivityTypes<const T extends Record<string, ActivityTypeDef>>(
  texts: TypeTexts,
  types: T,
): DefinedTypes<T, { readonly texts: TypeTexts }> {
  return Object.fromEntries(
    Object.entries(types).map(([type, def]) => [type, { ...def, texts }]),
  ) as DefinedTypes<T, { readonly texts: TypeTexts }>;
}

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never;

/**
 * Злиття груп типів у composition root. Той самий тип у двох групах — помилка зборки
 * модулів на старті, а не тихе перекриття одного визначення іншим.
 */
export function mergeTypeGroups<const G extends readonly Record<string, unknown>[]>(
  ...groups: G
): UnionToIntersection<G[number]> {
  const merged: Record<string, unknown> = {};
  for (const group of groups) {
    for (const [type, def] of Object.entries(group)) {
      if (type in merged) {
        throw new Error(`Type "${type}" is defined by two modules`);
      }
      merged[type] = def;
    }
  }
  return merged as UnionToIntersection<G[number]>;
}
