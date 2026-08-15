import { z } from 'zod';
import { defineEvent } from '../message-definition';

/**
 * Факт: користувача створено (адмінським create user). Продюсер не знає підписників —
 * їх перелічує MESSAGE_TOPOLOGY.
 */
export const userRegisteredEvent = defineEvent(
  'users.user-registered.v1',
  z.object({
    userId: z.uuid(),
    email: z.email(),
  }),
);
