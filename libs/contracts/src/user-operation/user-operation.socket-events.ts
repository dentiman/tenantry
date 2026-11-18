import { z } from 'zod';
import { defineSocketEvent } from '../realtime/socket-event';

/**
 * Операція змінилась (docs/user-operations.md §5). Лише id і `revision` — без стану: правда в
 * `GET /user-operations/:id`, клієнт перечитує, коли ревізія новіша за ту, що в нього
 * (правило 15 AGENTS.md: payload зі станом не возимо). Летить у особистий room власника.
 */
export const UserOperationChangedSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
});

export type UserOperationChanged = z.infer<typeof UserOperationChangedSchema>;

export const USER_OPERATION_SOCKET_EVENTS = {
  userOperationChanged: defineSocketEvent('user-operation.changed.v1', UserOperationChangedSchema),
};
