import type { z } from 'zod';
import { SettingsBootstrapCoreSchema } from './settings/settings.schema';
import { CalendarSettingsSchema } from './calendar/calendar-settings.schema';

/**
 * Composition root bootstrap-у (docs/modules.md §5): ядро settings плюс секції фіч, яким
 * потрібен перший рендер. Єдине місце в контрактах, що знає, які фічі кладуть сюди дані;
 * значення реєструють самі фічі (`BootstrapRegistry` в apps/api). Прибираючи фічу з
 * форку, прибери її рядок тут.
 *
 * `GET /settings/bootstrap` — курований read-only зріз для SPA: вантажиться раз на старті
 * сесії, доступний будь-якому автентифікованому, секретів тут не буває за визначенням.
 */
export const SettingsBootstrapSchema = SettingsBootstrapCoreSchema.extend({
  /**
   * Дефолти календаря їдуть у bootstrap свідомо: без них першим рендером неможливо
   * намалювати сітку (перший день тижня і робочі години), а другий запит дав би стрибок
   * розкладки.
   */
  calendar: CalendarSettingsSchema,
});

export type SettingsBootstrap = z.infer<typeof SettingsBootstrapSchema>;
