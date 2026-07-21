import { Injectable } from '@nestjs/common';
import { Prisma } from '@saas-skeleton/database';
import { ACTIVITY_PAYLOAD_SCHEMAS } from '@saas-skeleton/contracts';
import type { ActivityType, ActivityLinkRole } from '@saas-skeleton/contracts';

/**
 * Актор події. `user` — з auth-контексту (label = email/ім'я); `system` — worker/cron,
 * актора-людини немає (кожна подія має свого чесного актора).
 */
export type ActivityActor =
  | { type: 'user'; id: string; label: string }
  | { type: 'system' };

export interface RecordActivityInput {
  type: ActivityType;
  actor: ActivityActor;
  payload: Record<string, unknown>;
  links: { entityType: string; entityId: string; role?: ActivityLinkRole }[];
}

@Injectable()
export class ActivityRecorder {
  /**
   * tx — ПЕРШИЙ обов'язковий аргумент свідомо: recorder фізично неможливо викликати
   * поза транзакцією доменної зміни (API) чи inbox-у (worker). tenant_id не передається
   * ніде — DB-default із CLS, як у всіх таблицях (MT невидима для домену).
   */
  async record(tx: Prisma.TransactionClient, input: RecordActivityInput): Promise<void> {
    // fail fast: невалідний payload — це баг викликача, а не дані
    const payload = ACTIVITY_PAYLOAD_SCHEMAS[input.type].parse(input.payload);
    const activity = await tx.activity.create({
      data: {
        type: input.type,
        actorType: input.actor.type,
        actorId: input.actor.type === 'user' ? input.actor.id : null,
        actorLabel: input.actor.type === 'user' ? input.actor.label : null,
        payload,
      },
    });
    await tx.activityLink.createMany({
      data: input.links.map((l) => ({ activityId: activity.id, ...l })),
    });
  }
}
