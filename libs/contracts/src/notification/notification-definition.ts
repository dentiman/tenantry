import type { z } from 'zod';
import type { DefinedTypes, TypeTexts } from '../activity/activity-definition';

export interface NotificationTypeDef {
  /** Recorder валідує на записі (fail fast — невалідний payload це баг викликача) */
  readonly payload: z.ZodType;
  /**
   * Група на екрані налаштувань. Платформні — `organization` (усе, що стосується компанії)
   * і `security` (особиста безпека); фіча може оголосити свою (`calendar`), її підпис — у
   * текстах фічі. Слово `workspace` свідомо не вживаємо: воно зарезервоване за навігаційним
   * поняттям у сайдбарі (docs/settings.md § «Іменування»).
   */
  readonly category: string;
  /**
   * Дефолти живуть у КОДІ, не в БД: новий тип не потребує бекфілу преференсів для наявних
   * юзерів (рядок у notification_preferences зʼявляється тільки коли юзер явно змінив дефолт).
   */
  readonly defaultEnabled: boolean;
  /**
   * false = юзер не може вимкнути. Це не «забули дати перемикач»: про зміну власного
   * пароля людина мусить дізнатись незалежно від своїх налаштувань.
   */
  readonly muteable: boolean;
  /** Ключ payload-а з EntityRef, на сторінку якого веде посилання в тексті */
  readonly subject?: string;
}

/**
 * Типи сповіщень модуля-власника (docs/module-registries.md R1). Модуль `notifications`
 * дає лише механізм; визначення живуть у контрактах власника
 * (`calendar/calendar.notifications.ts`), збирає їх root `libs/contracts/src/notification-types.ts`.
 *
 * Тексти в неймспейсі `texts`: `type.<тип>` — сам текст (з плюралами для схлопнутих груп),
 * `label.<тип>` — підпис на екрані налаштувань, `category.<категорія>` — заголовок групи.
 */
export function defineNotificationTypes<const T extends Record<string, NotificationTypeDef>>(
  texts: TypeTexts,
  types: T,
): DefinedTypes<T, { readonly texts: TypeTexts }> {
  return Object.fromEntries(
    Object.entries(types).map(([type, def]) => [type, { ...def, texts }]),
  ) as DefinedTypes<T, { readonly texts: TypeTexts }>;
}
