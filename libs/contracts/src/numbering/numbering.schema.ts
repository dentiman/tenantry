import { z } from 'zod';

/**
 * Нумерація людських номерів (docs/customers.md §5).
 *
 * Номер сутності — ЦІЛЕ число, своє в кожного тенанта; префікс і доповнення
 * нулями — presentation, а не частина ідентичності. Тому в контрактах їдуть
 * обидва: `number` (машинне, по ньому сортування, фільтри й точний пошук) і
 * `numberLabel` (те, що людина називає в розмові й пише в листі).
 */

/**
 * Простори нумерації. Закритий перелік: черга на новий простір — рядок тут
 * плюс дефолт нижче, а не довільний рядок від клієнта (інакше в конфізі
 * тенанта заводилися б серії-привиди з друкарських помилок).
 */
export const NUMBER_SERIES_NAMES = ['customer'] as const;
export const NumberSeriesNameSchema = z.enum(NUMBER_SERIES_NAMES);
export type NumberSeriesName = z.infer<typeof NumberSeriesNameSchema>;

/**
 * Період скидання лічильника. Для МАЙСТЕР-ДАНИХ завжди NONE (нумерувати клієнтів
 * заново щороку не робить жодна система) — YEARLY/MONTHLY заводяться під
 * ДОКУМЕНТИ, де «рахунок №1 за 2027 рік» — норма. Перелік оголошений зараз, бо
 * від нього залежить ключ лічильника, а міняти PK згодом дорожче.
 */
export const NumberResetPeriodSchema = z.enum(['NONE', 'YEARLY', 'MONTHLY']);
export type NumberResetPeriod = z.infer<typeof NumberResetPeriodSchema>;

export interface NumberSeriesDefault {
  readonly prefix: string;
  readonly padding: number;
  readonly startValue: number;
  readonly resetPeriod: NumberResetPeriod;
  /** false — перемикач періоду не показуємо: у майстер-даних він безглуздий */
  readonly resettable: boolean;
}

/**
 * Дефолти живуть у КОДІ, як у NOTIFICATION_TYPE_META: рядок у `number_series`
 * з'являється тільки коли тенант явно змінив формат, і новий простір не потребує
 * бекфілу для наявних тенантів.
 */
export const NUMBER_SERIES_DEFAULTS = {
  customer: { prefix: 'C-', padding: 6, startValue: 1, resetPeriod: 'NONE', resettable: false },
} as const satisfies Record<NumberSeriesName, NumberSeriesDefault>;

/** Межі формату: padding 0 = без доповнення нулями */
export const NumberPaddingSchema = z.number().int().min(0).max(12);
export const NumberValueSchema = z.number().int().min(1).max(2_000_000_000);

export const UpdateNumberSeriesSchema = z.object({
  prefix: z.string().trim().max(16).optional(),
  padding: NumberPaddingSchema.optional(),
  /**
   * Перший номер у КОЖНОМУ новому періоді. На вже початий лічильник не впливає —
   * для нього є окрема операція (див. SetNextNumberSchema): міняти виданий
   * діапазон заднім числом не можна.
   */
  startValue: NumberValueSchema.optional(),
});

/**
 * «Наступний номер = N» — операція над лічильником, а не над конфігом, тому
 * окремий ендпоінт. Дозволена ТІЛЬКИ вгору: попередні номери вже видані, і
 * зниження гарантує колізію на унікальному індексі. Головний сценарій —
 * імпорт старої бази: залили свої номери, підняли лічильник до максимуму.
 */
export const SetNextNumberSchema = z.object({
  nextNumber: NumberValueSchema,
});

export const NumberSeriesResponseSchema = z.object({
  name: NumberSeriesNameSchema,
  prefix: z.string(),
  padding: z.number().int(),
  startValue: z.number().int(),
  resetPeriod: NumberResetPeriodSchema,
  resettable: z.boolean(),
  /** Номер, який отримає наступна створена сутність (у поточному періоді) */
  nextNumber: z.number().int(),
  /** Готовий приклад для екрана налаштувань: як виглядатиме наступний номер */
  nextLabel: z.string(),
  /** false — тенант ще не міняв дефолт, рядка в БД немає */
  isCustomized: z.boolean(),
});

export const NumberSeriesListResponseSchema = z.object({
  items: z.array(NumberSeriesResponseSchema),
});
