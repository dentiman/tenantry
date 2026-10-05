import { z } from 'zod';

// Секція `ai` налаштувань організації належить модулю `ai`, а не `settings`
// (docs/modules.md): settings лише зберігає секції в `Tenant.settings` JSON, а схему,
// валідацію й ендпоінти `GET/PUT /settings/ai` тримає фіча. Прибрав фічу — секція зникла
// разом із нею, контракт налаштувань не змінився.

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
