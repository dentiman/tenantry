import { z } from 'zod';
import { EntityRefSchema, defineActivityTypes } from '../activity/activity-definition';

/**
 * Типи активності календаря (docs/calendar.md §9.1). Знову окремі типи, а не один
 * `calendar_event.updated`: «хто пересунув зустріч» питають найчастіше, і це мусить
 * фільтруватися по type. Редагування назви чи опису в журнал НЕ йде — інакше фід кастомера
 * потоне в шумі.
 *
 * Тексти — у неймспейсі `calendar`, ключ `activity.<тип>`.
 */
export const CALENDAR_ACTIVITIES = defineActivityTypes(
  { ns: 'calendar', prefix: 'activity' },
  {
    'calendar_event.created': {
      payload: z.object({
        event: EntityRefSchema, // kind: 'calendar_event'
        startsAt: z.iso.datetime(),
        // Снапшот контексту: подія могла бути привʼязана до кастомера, і фід
        // кастомера читає саме цей лінк
        customer: EntityRefSchema.nullable(),
      }),
    },
    // Перенесення — окремий тип із ОБОМА моментами: «на коли перенесли» без
    // «з коли» не читається, а join на живий рядок фід робити не має права
    'calendar_event.rescheduled': {
      payload: z.object({
        event: EntityRefSchema,
        previousStartsAt: z.iso.datetime(),
        startsAt: z.iso.datetime(),
      }),
    },
    'calendar_event.cancelled': {
      payload: z.object({
        event: EntityRefSchema,
      }),
    },
    'calendar_event.restored': {
      payload: z.object({
        event: EntityRefSchema,
        status: z.enum(['CONFIRMED', 'TENTATIVE']), // куди саме повернули зі скасування
      }),
    },
    'calendar_event.deleted': {
      payload: z.object({
        // Лінк лишається на неіснуючий id — журнал переживає сутність
        event: EntityRefSchema,
      }),
    },
    'calendar_event.attendee_added': {
      payload: z.object({
        event: EntityRefSchema,
        attendee: EntityRefSchema, // kind: 'user'
      }),
    },
    'calendar_event.attendee_removed': {
      payload: z.object({
        event: EntityRefSchema,
        attendee: EntityRefSchema,
      }),
    },
    'calendar_event.rsvp_changed': {
      payload: z.object({
        event: EntityRefSchema,
        attendee: EntityRefSchema,
        response: z.enum(['NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']),
      }),
    },
  },
);
