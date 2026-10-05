import { z } from 'zod';
import { EntityRefSchema } from '../activity/activity-definition';
import { defineNotificationTypes } from '../notification/notification-definition';

/**
 * Сповіщення календаря (docs/calendar.md §9.2). Тексти — у неймспейсі `calendar`, ключі
 * `notifications.*`.
 *
 * Календар має СВОЮ категорію `calendar` («мій час»: запрошення, перенесення, нагадування),
 * а не рядок в `organization` (рішення 2026-09-06): категорія — заголовок групи на екрані
 * преференсів, і «нагадування про зустріч» поруч зі «створено юзера» — неправильна
 * ментальна модель. Ціна нульова: категорії живуть у коді, міграції не потребують.
 */
export const CALENDAR_NOTIFICATIONS = defineNotificationTypes(
  { ns: 'calendar', prefix: 'notifications' },
  {
    // startsAt у payload-і, а не join на подію: рядок інбокса рендериться без
    // звертання до живих таблиць (те саме правило, що в activities), а «коли»
    // тут — половина сенсу повідомлення
    'calendar_event.invited': {
      payload: z.object({
        event: EntityRefSchema, // kind: 'calendar_event'
        startsAt: z.iso.datetime(),
        allDay: z.boolean(),
      }),
      category: 'calendar',
      defaultEnabled: true,
      muteable: true,
      subject: 'event',
    },
    'calendar_event.rescheduled': {
      payload: z.object({
        event: EntityRefSchema,
        startsAt: z.iso.datetime(),
        allDay: z.boolean(),
      }),
      category: 'calendar',
      defaultEnabled: true,
      muteable: true,
      subject: 'event',
    },
    'calendar_event.cancelled': {
      payload: z.object({
        event: EntityRefSchema,
        startsAt: z.iso.datetime(),
        allDay: z.boolean(),
      }),
      category: 'calendar',
      defaultEnabled: true,
      muteable: false,
      subject: 'event',
    },
    'calendar_event.rsvp_changed': {
      payload: z.object({
        event: EntityRefSchema,
        attendee: EntityRefSchema,
        response: z.enum(['NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']),
      }),
      category: 'calendar',
      defaultEnabled: true,
      muteable: true,
      subject: 'event',
    },
    'calendar_event.reminder': {
      payload: z.object({
        event: EntityRefSchema,
        startsAt: z.iso.datetime(),
        allDay: z.boolean(),
        /** «за 30 хв» — рядок інбокса підписує, ЧОМУ він прийшов саме зараз */
        minutesBefore: z.number().int().nonnegative(),
      }),
      category: 'calendar',
      defaultEnabled: true,
      muteable: true,
      subject: 'event',
    },
  },
);
