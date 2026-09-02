import { z } from 'zod';
import { CurrencyCodeSchema } from '../money/money.schema';
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
   * Порожня мапа у V1 — ключ закладений, щоб feature-gating не вимагав нового
   * ендпоінта (секція `features` у беклозі doc-а)
   */
  features: z.record(z.string(), z.boolean()),
});
