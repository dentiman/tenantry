import { z } from 'zod';
import { CurrencyCodeSchema } from '../money/money.schema';
import { TimeOfDaySchema, TimeZoneSchema, WeekStartSchema } from '../time/time.schema';
import { UserLocaleSchema } from '../user/user.schema';

/**
 * Налаштування ОРГАНІЗАЦІЇ (docs/settings.md) — те, що належить компанії, а не
 * людині. Межа проста: «якщо цей юзер піде з компанії, налаштування піде з ним?»
 * Так → `/account` (особисте), ні → сюди.
 *
 * Іменування — патерн, домінантний у B2B (GitLab, Stripe, Notion, HubSpot):
 * словом **Settings** володіє організація, а особисте отримує кваліфікатор
 * («User settings»). Причина не в смаках: людина шукає «налаштування» тоді,
 * коли їй треба налаштувати БІЗНЕС, а не власну тему оформлення.
 *
 * Суб'єкт береться з токена, id у шляху немає — та сама доктрина, що в
 * `/account`: відсутність id і є твердженням «чужа організація через цей
 * ендпоінт недосяжна», і воно не залежить від уважності в сервісі.
 */

/**
 * Секція `general` — ОДИН документ, тому PUT (повна заміна, ідемпотентна),
 * а не PATCH. Поля тут лише ті, що редагує tenant-адмін: `slug` і `isActive`
 * platform-scoped і в цій схемі фізично відсутні — їх неможливо прислати.
 */
export const GeneralSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Дефолтна локаль нових юзерів організації */
  locale: UserLocaleSchema,
  /** Дефолтна валюта: нові кастомери і будь-який показ сум */
  currency: CurrencyCodeSchema,
});

export const GeneralSettingsResponseSchema = GeneralSettingsSchema.extend({
  /** Read-only: slug змінює тільки оператор платформи (на ньому тримається логін) */
  slug: z.string(),
});

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

/**
 * Секція `ai` — персона й інструкції AI-асистента для ЦІЄЇ організації
 * (docs/ai-assistant.md §7.3, крок AI-1c). Теж документ у `Tenant.settings` JSON,
 * `GET`/`PUT`, повна заміна — і обидва ендпоінти лише для ADMIN: жоден екран поза
 * редактором її не читає (воркер бере рядок тенанта напряму), а адмін може писати
 * туди внутрішні формулювання.
 *
 * Порожній рядок = «не задано»: одне написання замість трьох (`null`, відсутній
 * ключ, `''`), і тип форми лишається без `| undefined` (той самий принцип, що
 * CALENDAR_SETTINGS_DEFAULTS). `trim` ДО `max` — пробіли на краях не з'їдають
 * ліміт, а поле з самих пробілів стає «не задано».
 *
 * Це конфігурація, написана адміном, а не дані юзера: вона йде в промпт ПІСЛЯ
 * незмінних меж асистента і не може їх прибрати (docs/ai-assistant-implementation.md).
 */
export const AI_SETTINGS_LIMITS = {
  /** Персона — речення-два («You are Ava, the helpdesk assistant of Acme») */
  personaMaxChars: 500,
  /** Той самий ліміт, що в питання юзера; разом ≈ 1 100 токенів у найгіршому разі */
  instructionsMaxChars: 4000,
} as const;

export const AiSettingsSchema = z.object({
  /**
   * Вибір Tenant Admin (AI-5a): чи вмикає компанія асистента своїм людям. Діє лише разом
   * із вмикачем і дозволом платформи (docs/ai-platform-controls.md §2.5)
   */
  enabled: z.boolean(),
  persona: z.string().trim().max(AI_SETTINGS_LIMITS.personaMaxChars),
  instructions: z.string().trim().max(AI_SETTINGS_LIMITS.instructionsMaxChars),
});

/**
 * Доступність асистента для tenant-а (AI-5a): чотири рівні окремо, щоб екран Tenant Admin
 * міг сказати, ЧОМУ асистент недоступний — і не пропонувати вмикач, який нічого не змінить.
 */
export const AiAvailabilitySchema = z.object({
  /** `AI_ENABLED` інсталяції */
  installation: z.boolean(),
  /** Вмикач оператора платформи */
  platform: z.boolean(),
  /** Дозвіл платформи цьому tenant-у */
  tenantAllowed: z.boolean(),
  /** Вибір Tenant Admin */
  tenantEnabled: z.boolean(),
  /** Усе разом */
  available: z.boolean(),
});

/** Секція плюс read-only доступність — те, що віддає `GET/PUT /settings/ai` */
export const AiSettingsResponseSchema = AiSettingsSchema.extend({
  availability: AiAvailabilitySchema,
});

/** Відсутній ключ `ai` читається як «нічого не задано» — бекфіл не потрібен */
export const AI_SETTINGS_DEFAULTS: z.infer<typeof AiSettingsSchema> = {
  // Увімкнено: tenant-и, що існували до AI-5a, не втрачають асистента
  enabled: true,
  persona: '',
  instructions: '',
};

/**
 * Курований read-only зріз для SPA: вантажиться раз на старті сесії і живе в
 * сторі. Доступний БУДЬ-ЯКОМУ автентифікованому — на відміну від редактора,
 * бо форматування валюти й feature-gating потрібні кожному екрану.
 * Секретів тут не буває за визначенням.
 */
export const SettingsBootstrapSchema = z.object({
  // Ключ дзеркалить назву секції (`/settings/general`), а не вводить ще один
  // іменник для тієї самої сутності
  general: z.object({
    name: z.string(),
    slug: z.string(),
    locale: z.string(),
    currency: z.string(),
  }),
  /**
   * Дефолти календаря їдуть у bootstrap свідомо: без них першим рендером
   * неможливо намалювати сітку (перший день тижня і робочі години), а другий
   * запит дав би стрибок розкладки.
   */
  calendar: CalendarSettingsSchema,
  /**
   * Порожня мапа у V1 — ключ закладений, щоб feature-gating не вимагав нового
   * ендпоінта (секція `features` у беклозі doc-а)
   */
  features: z.record(z.string(), z.boolean()),
});
