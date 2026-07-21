import type { Activity as PrismaActivity } from '@saas-skeleton/database';
import type { ActivityResponse } from '@saas-skeleton/contracts';

/**
 * type/actorType зберігаються в БД як string; валідність гарантує вхідний контракт
 * (ACTIVITY_TYPES у recorder-і). payload — Json, форму звужує ACTIVITY_PAYLOAD_SCHEMAS[type].
 */
export function toActivityResponse(a: PrismaActivity): ActivityResponse {
  return {
    id: a.id,
    type: a.type as ActivityResponse['type'],
    actorType: a.actorType as ActivityResponse['actorType'],
    actorId: a.actorId,
    actorLabel: a.actorLabel,
    payload: a.payload as Record<string, unknown>,
    createdAt: a.createdAt.toISOString(),
  };
}
