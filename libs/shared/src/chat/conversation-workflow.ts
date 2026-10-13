import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import type { ConversationStatus } from '@saas-skeleton/contracts';
import { ActivityRecorder } from '../activities/activity-recorder.service';

/** Хто змінює: людина, клієнт (вхідне повідомлення) або система */
export type WorkflowActor =
  | { type: 'user'; id: string; label: string }
  | { type: 'customer'; label: string };

export type StatusChange = 'changed' | 'unchanged' | 'blocked';

/**
 * Робочий процес клієнтської розмови: статус, призначення, привласнення відповіддю (CHAT-2b,
 * design.md D5, D7). Спільний для API (ручні дії і відповідь) та воркера (вхідне повертає
 * `PENDING → OPEN`), тож живе тут, а не в одному з них.
 *
 * Кожен метод — умовний `UPDATE`, який повертає, чи справді щось змінилося: зміна «на те саме»
 * (подвійний клік) не пише ні запису в стрічку, ні активності. І запис, і активність пишуться в
 * `tx` викликача, тож відкочена зміна не лишає жодного з них. `tx` — завжди ПЕРШИЙ аргумент.
 *
 * Учасник клієнтської розмови — її поточний відповідальний (D7): призначення вставляє/оживляє його
 * рядок і знімає попередній, тому лічильники непрочитаного й фільтр «мої» працюють без змін.
 */
@Injectable()
export class ConversationWorkflow {
  constructor(private readonly activities: ActivityRecorder) {}

  /**
   * Змінити статус. `blocked` — відкрити розв'язану розмову не можна, бо в контакта вже є інша
   * відкрита (частковий UNIQUE це заборонив би; перевіряємо в самому UPDATE, а не ловимо помилку,
   * яка обірвала б транзакцію).
   */
  async setStatus(
    tx: Prisma.TransactionClient,
    conversationId: string,
    to: ConversationStatus,
    actor: WorkflowActor,
  ): Promise<StatusChange> {
    const rows = await tx.$queryRaw<{ from: ConversationStatus }[]>`
      WITH old AS (
        SELECT id, status, contact_id FROM conversations WHERE id = ${conversationId} FOR UPDATE
      )
      UPDATE conversations c
      SET status = ${to}::"ConversationStatus",
          resolved_at = CASE WHEN ${to} = 'RESOLVED' THEN now() ELSE NULL END,
          updated_at = now()
      FROM old
      WHERE c.id = old.id AND old.status <> ${to}::"ConversationStatus"
        AND (${to} = 'RESOLVED' OR old.status <> 'RESOLVED' OR old.contact_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM conversations o
          WHERE o.contact_id = old.contact_id AND o.id <> old.id AND o.status <> 'RESOLVED'
        ))
      RETURNING old.status AS "from"`;
    const changed = rows[0];
    if (!changed) {
      const current = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { status: true },
      });
      return current && current.status !== to ? 'blocked' : 'unchanged';
    }

    await this.recordStatusChange(tx, conversationId, changed.from, to, actor);
    return 'changed';
  }

  /** Запис у стрічку й активність про вже виконану зміну статусу (ingest відкриває розмову сам) */
  async recordStatusChange(
    tx: Prisma.TransactionClient,
    conversationId: string,
    from: ConversationStatus,
    to: ConversationStatus,
    actor: WorkflowActor,
  ): Promise<void> {
    await this.writeEntry(tx, conversationId, { type: 'conversation.status_changed', from, to }, actor);
    const ref = await this.conversationRef(tx, conversationId);
    await this.activities.record(tx, {
      type: 'conversation.status_changed',
      actor: toActivityActor(actor),
      payload: { conversation: ref.entity, from, to },
      links: ref.links,
    });
  }

  /**
   * Призначити (або зняти: `null`). Повертає `true`, якщо відповідальний справді змінився.
   * Цільовий юзер уже перевірений викликачем (активний юзер цього тенанта).
   */
  async assign(
    tx: Prisma.TransactionClient,
    conversationId: string,
    assignee: { id: string; label: string } | null,
    actor: WorkflowActor,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ previous: string | null }[]>`
      WITH old AS (SELECT id, assignee_id FROM conversations WHERE id = ${conversationId} FOR UPDATE)
      UPDATE conversations c
      SET assignee_id = ${assignee?.id ?? null}, updated_at = now()
      FROM old
      WHERE c.id = old.id AND old.assignee_id IS DISTINCT FROM ${assignee?.id ?? null}
      RETURNING old.assignee_id AS previous`;
    if (!rows[0]) {
      return false;
    }
    await this.afterAssigned(tx, conversationId, assignee, actor);
    return true;
  }

  /**
   * Відповідь у нічию розмову привласнює її автору: умовний `UPDATE … WHERE assignee_id IS NULL`
   * вирішує гонку двох перших відповідей — переможець рівно один. `true`, якщо привласнили саме ми.
   */
  async claimIfUnassigned(
    tx: Prisma.TransactionClient,
    conversationId: string,
    user: { id: string; label: string },
  ): Promise<boolean> {
    const claimed = await tx.$executeRaw`
      UPDATE conversations SET assignee_id = ${user.id}, updated_at = now()
      WHERE id = ${conversationId} AND assignee_id IS NULL`;
    if (claimed === 0) {
      return false;
    }
    await this.afterAssigned(tx, conversationId, user, { type: 'user', id: user.id, label: user.label });
    return true;
  }

  // -------------------------------------------------------------------------

  private async afterAssigned(
    tx: Prisma.TransactionClient,
    conversationId: string,
    assignee: { id: string; label: string } | null,
    actor: WorkflowActor,
  ): Promise<void> {
    // Колишній відповідальний перестає бути учасником; новий — вставляється або оживає
    await tx.conversationParticipant.updateMany({
      where: { conversationId, leftAt: null, ...(assignee && { userId: { not: assignee.id } }) },
      data: { leftAt: new Date() },
    });
    if (assignee) {
      await this.joinAsAssignee(tx, conversationId, assignee.id);
    }

    await this.writeEntry(
      tx,
      conversationId,
      { type: 'conversation.assigned', assignee: assignee ? { id: assignee.id, label: assignee.label } : null },
      actor,
    );
    const ref = await this.conversationRef(tx, conversationId);
    await this.activities.record(tx, {
      type: 'conversation.assigned',
      actor: toActivityActor(actor),
      payload: {
        conversation: ref.entity,
        assignee: assignee ? { kind: 'user', id: assignee.id, label: assignee.label } : null,
      },
      links: ref.links,
    });
  }

  /**
   * Новий відповідальний бачить непрочитаним те, що клієнт написав після останньої репліки
   * агента: інакше призначення «з чистого аркуша» ховало б від нього розмову, на яку чекають.
   */
  private async joinAsAssignee(
    tx: Prisma.TransactionClient,
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const lastReply = await tx.chatMessage.aggregate({
      where: { conversationId, direction: 'OUTBOUND', visibility: 'PUBLIC' },
      _max: { seq: true },
    });
    const awaiting = await tx.chatMessage.count({
      where: {
        conversationId,
        direction: 'INBOUND',
        deletedAt: null,
        seq: { gt: lastReply._max.seq ?? 0 },
      },
    });
    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadSeq: 0, unreadCount: awaiting },
      update: { leftAt: null, lastReadSeq: 0, unreadCount: awaiting },
    });
  }

  /** Системний запис: наступний `seq`, без прев'ю й без зміни `last_message_at` (не репліка) */
  private async writeEntry(
    tx: Prisma.TransactionClient,
    conversationId: string,
    payload: Prisma.InputJsonObject,
    actor: WorkflowActor,
  ): Promise<void> {
    const { lastSeq } = await tx.conversation.update({
      where: { id: conversationId },
      data: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    });
    await tx.chatMessage.create({
      data: {
        conversationId,
        seq: lastSeq,
        kind: 'SYSTEM',
        // Службова подія команди: клієнтові вона ніколи не йде
        visibility: 'INTERNAL',
        status: 'SENT',
        senderType: actor.type === 'user' ? 'user' : 'customer',
        senderUserId: actor.type === 'user' ? actor.id : null,
        senderLabel: actor.label,
        payload,
      },
    });
  }

  /** Посилання для активності: розмова і, якщо контакт привʼязано, клієнт */
  private async conversationRef(
    tx: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<{
    entity: { kind: 'conversation'; id: string; label: string };
    links: { entityType: string; entityId: string }[];
  }> {
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        id: true,
        title: true,
        contact: {
          select: {
            displayName: true,
            customerId: true,
            addresses: { select: { value: true }, take: 1, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    const label =
      conversation.title ??
      conversation.contact?.displayName ??
      conversation.contact?.addresses[0]?.value ??
      'Conversation';
    const links = [{ entityType: 'conversation', entityId: conversation.id }];
    if (conversation.contact?.customerId) {
      links.push({ entityType: 'customer', entityId: conversation.contact.customerId });
    }
    return { entity: { kind: 'conversation', id: conversation.id, label }, links };
  }
}

function toActivityActor(actor: WorkflowActor): { type: 'user'; id: string; label: string } | { type: 'system' } {
  return actor.type === 'user' ? actor : { type: 'system' };
}
