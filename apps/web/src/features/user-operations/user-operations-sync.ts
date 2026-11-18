import { REALTIME_EVENTS, type UserOperationChanged } from '@saas-skeleton/contracts';
import { getSocket } from '../realtime/socket';
import { onUserOperationChanged, resyncActiveUserOperations } from './user-operations.source';

/**
 * Міст socket → лоток для операцій користувача. Подія несе лише id і ревізію (правило 15
 * AGENTS.md); після кожного підключення активні операції перечитуються з REST, тож операція,
 * запущена до перезавантаження сторінки, знову зʼявляється в лотку з поточним прогресом.
 */
export function initUserOperationsSync(): void {
  const socket = getSocket();
  socket.on(REALTIME_EVENTS.userOperationChanged, (payload: UserOperationChanged) => {
    void onUserOperationChanged(payload.id, payload.revision);
  });
  socket.on('connect', () => {
    void resyncActiveUserOperations();
  });
}
