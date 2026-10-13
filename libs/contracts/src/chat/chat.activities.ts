import { z } from 'zod';
import { EntityRefSchema, defineActivityTypes } from '../activity/activity-definition';
import { ConversationStatusSchema } from './chat.schema';

/**
 * Активність клієнтських розмов (CHAT-2b, docs/chat.md §4.11): призначення і зміна статусу. Лінкуються до
 * розмови і — коли контакт привʼязано — до клієнта, тож стрічка картки клієнта показує історію
 * звернень без окремого запиту. У загальну стрічку воркспейсу не йдуть (`workspace` не задано):
 * це робочий шум команди, а не подія організації.
 *
 * Тексти — у неймспейсі `chat`, ключ `activity.<тип>`.
 */
export const CHAT_ACTIVITIES = defineActivityTypes(
  { ns: 'chat', prefix: 'activity' },
  {
    'conversation.assigned': {
      payload: z.object({
        conversation: EntityRefSchema, // kind: 'conversation'
        // null — призначення знято
        assignee: EntityRefSchema.nullable(),
      }),
      // Зняття — окрема фраза, а не «призначено на ніхто»
      textVariant: (payload) => (payload.assignee === null ? 'conversation.unassigned' : undefined),
    },
    'conversation.status_changed': {
      payload: z.object({
        conversation: EntityRefSchema,
        from: ConversationStatusSchema,
        to: ConversationStatusSchema,
      }),
      // Базова фраза — «відкрила знову» (в OPEN потрапляють з RESOLVED/PENDING); решта — окремі
      textVariant: (payload) =>
        payload.to === 'RESOLVED'
          ? 'conversation.resolved'
          : payload.to === 'PENDING'
            ? 'conversation.set_pending'
            : undefined,
    },
  },
);
