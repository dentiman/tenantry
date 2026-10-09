import { Injectable } from '@nestjs/common';
import { TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { ChatMessage, Prisma } from '@saas-skeleton/database';
import { REALTIME_EVENTS, type ChatConversationChange } from '@saas-skeleton/contracts';
import { activeParticipantIds } from '@saas-skeleton/shared';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { toChatMessageResponse } from './chat.mapper';

/**
 * Усе, що чат повідомляє через сокет, — і кому саме, — в одному місці (docs/chat.md §4.8,
 * design.md D3). Методів «під чат» в `RealtimeEmitter` немає: він generic (`toUsers`), як і
 * для calendar та ai (docs/modules.md §7.2).
 *
 * Два правила, на яких усе тримається:
 *
 * 1. Одержувачі читаються В ТІЙ САМІЙ транзакції, що пише зміну (design.md D1): рядок
 *    розмови вже заблоковано інкрементом `last_seq`, тож склад учасників відповідає стрічці,
 *    до якої належить запис. Це та сама множина, яку пускає `ConversationAccessService`.
 * 2. Емісія — ПІСЛЯ КОМІТУ (`onCommit` того самого `withTenantTx`). До коміту клієнт пішов
 *    би за списком і не побачив рядка, а відкочена транзакція сповістила б про те, чого
 *    немає. Через pg-boss йти не можна: це були б секунди polling-у, а втрата події нічого
 *    не втрачає — стан тримає Postgres (docs/realtime.md, «Межа з event-driven шаром»).
 */
@Injectable()
export class ChatRealtime {
  constructor(
    private readonly realtime: RealtimeEmitter,
    private readonly tenantContext: TenantContextService,
    private readonly transactions: TenantTransactions,
  ) {}

  /**
   * Новий запис у стрічці — усім активним учасникам, автора включно (його інші вкладки).
   * Payload — повний рядок у формі REST-відповіді.
   */
  async messageCreated(tx: Prisma.TransactionClient, message: ChatMessage): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const recipients = await activeParticipantIds(tx, message.conversationId);
    if (recipients.length === 0) {
      return;
    }

    const payload = {
      conversationId: message.conversationId,
      message: toChatMessageResponse(message),
      occurredAt: new Date().toISOString(),
    };
    this.transactions.onCommit(tx, () => {
      this.realtime.toUsers(tenantId, recipients, REALTIME_EVENTS.chatMessageCreated, payload);
    });
  }

  /**
   * Зміна на рівні розмови — сигнал «перечитай» без лічильників і прев'ю (вони персональні).
   * `recipientIds` задають, коли одержувачі вже відомі (власник курсора для `read`, склад щойно
   * створеної розмови); інакше — усі активні учасники.
   */
  async conversationChanged(
    tx: Prisma.TransactionClient,
    conversationId: string,
    change: ChatConversationChange,
    recipientIds?: readonly string[],
  ): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const recipients = recipientIds ?? (await activeParticipantIds(tx, conversationId));
    if (recipients.length === 0) {
      return;
    }

    const payload = { conversationId, change, occurredAt: new Date().toISOString() };
    this.transactions.onCommit(tx, () => {
      this.realtime.toUsers(tenantId, recipients, REALTIME_EVENTS.chatConversationChanged, payload);
    });
  }
}
