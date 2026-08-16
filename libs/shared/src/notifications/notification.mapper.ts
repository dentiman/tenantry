import type { Notification as PrismaNotification } from '@saas-skeleton/database';
import type { NotificationResponse } from '@saas-skeleton/contracts';

/**
 * Мапер живе в `libs/shared`, а не в `apps/api/src/notifications/`, бо той самий
 * рядок треба віддати двом споживачам: HTTP-відповіді і socket-події, яку кладе
 * recorder (він у shared). `apps/api` реекспортує його своїм шаром мапера.
 *
 * type/actorType зберігаються в БД як string; валідність гарантує вхідний контракт
 * (NOTIFICATION_TYPES у recorder-і), як і в activities.
 */
export function toNotificationResponse(n: PrismaNotification): NotificationResponse {
  return {
    id: n.id,
    type: n.type as NotificationResponse['type'],
    payload: n.payload as Record<string, unknown>,
    // Пара kind+id або обидва NULL — розкладати її на два опційні поля назовні
    // означало б віддати клієнту стан «є kind, немає id», якого не буває
    target: n.targetKind && n.targetId ? { kind: n.targetKind, id: n.targetId } : null,
    groupCount: n.groupCount,
    actorType: n.actorType as NotificationResponse['actorType'],
    actorId: n.actorId,
    actorLabel: n.actorLabel,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    archivedAt: n.archivedAt?.toISOString() ?? null,
  };
}
