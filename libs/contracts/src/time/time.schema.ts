import { z } from 'zod';

/**
 * Примітиви часу, спільні для календаря і налаштувань (docs/calendar.md §6).
 * Окремий модуль, а не поле в calendar.schema: налаштування організації теж
 * тримають зону і робочі години, а взаємні імпорти між секціями контрактів —
 * найдешевший спосіб отримати цикл.
 */

/**
 * IANA-зона (`Europe/Kyiv`), а НЕ offset (`+03:00`): offset — властивість
 * МОМЕНТУ, після переходу на зимовий час він інший, тому «щовівторка о 10:00»
 * поїхало б на годину.
 *
 * Перевіряємо не регуляркою, а самою платформою: `Intl` тримає актуальну базу
 * зон, і список валідних значень змінюється без нашої участі (зони перейменовують
 * і скасовують реально — `Europe/Kiev` → `Europe/Kyiv`, `America/Godthab` →
 * `America/Nuuk`). Регулярка `\w+/\w+` пропустила б `Mordor/Barad-dur`.
 */
export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown IANA time zone' },
  );

/** «HH:mm» — час доби без дати (робочі години). Плаваючий: зони в нього не буває */
export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/**
 * Перший день тижня у форматі `Date.getDay()` (0 = неділя). Числом, а не
 * enum-ом назв: у такому вигляді його споживають і `Intl`, і сітка календаря.
 * Реально осмислені лише 0/1/6, але звужувати не варто — календарні традиції
 * ширші за наші уявлення про них.
 */
export const WeekStartSchema = z.number().int().min(0).max(6);
