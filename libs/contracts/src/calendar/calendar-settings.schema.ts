import { z } from 'zod';
import { TimeOfDaySchema, TimeZoneSchema, WeekStartSchema } from '../time/time.schema';

// Секція `calendar` налаштувань організації належить модулю `calendar` (docs/modules.md):
// settings лише зберігає її в `Tenant.settings` JSON, а схему, ендпоінти
// `GET/PUT /settings/calendar` і внесок у bootstrap тримає календар.

/**
 * Секція `calendar` — дефолти КОМПАНІЇ для календаря (docs/calendar.md §9.5).
 * Теж документ: `GET`/`PUT`, повна заміна.
 *
 * **Живе в `Tenant.settings` JSON, а не в колонках** — перший реальний споживач
 * гібридного сховища з docs/settings.md: секція згрупована, БД її ніколи не
 * запитує (платформа не питатиме «усі тенанти з weekStartsOn=1»), і тумблери
 * тут додаватимуться швидше, ніж хочеться писати міграцію на кожен. Побічний
 * приз: наявним тенантам не потрібен бекфіл — відсутній ключ читається як
 * дефолти цієї ж схеми (патерн `notification_preferences`).
 */
type CalendarSettingsValue = z.infer<typeof CalendarSettingsSchema>;

export const CalendarSettingsSchema = z.object({
  /** Зона за замовчуванням: фолбек для юзерів, які свою не задали */
  timeZone: TimeZoneSchema,
  weekStartsOn: WeekStartSchema,
  /** Робочі години — до них скролиться сітка дня при відкритті */
  workDayStart: TimeOfDaySchema,
  workDayEnd: TimeOfDaySchema,
  defaultEventDurationMinutes: z.number().int().min(5).max(1440),
  /**
   * Дефолтне нагадування для події з часом, у хвилинах до початку.
   * `null` — «за замовчуванням не нагадувати» (легальний вибір, а не «не задано»).
   */
  defaultReminderMinutes: z.number().int().min(0).max(40_320).nullable(),
  /**
   * Дефолт для all-day. Окреме поле, бо «за 10 хвилин» для події на цілий день
   * безглузде: 900 хв = 09:00 попереднього дня — саме те, що робить Google.
   */
  defaultAllDayReminderMinutes: z.number().int().min(0).max(40_320).nullable(),
});

/**
 * Дефолти — ДАНІ, а не `.default()` у схемі. Причина практична: `.default()`
 * робить кожне поле опційним у `z.input`, і форма на react-hook-form отримує
 * тип, у якому все `| undefined` — далі або каст резолвера, або три generic-и
 * у кожному `useForm`. Схема лишається строгою, а «чого бракує» вирішує той,
 * хто читає (сервіс — при розборі JSON-секції, фронт — до першого запиту).
 */
export const CALENDAR_SETTINGS_DEFAULTS: CalendarSettingsValue = {
  timeZone: 'UTC',
  weekStartsOn: 1,
  workDayStart: '09:00',
  workDayEnd: '18:00',
  defaultEventDurationMinutes: 30,
  defaultReminderMinutes: 10,
  defaultAllDayReminderMinutes: 900,
};
