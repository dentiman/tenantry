import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import { NonRetryableMessageError } from '../messaging/messaging.errors';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { toPreview } from './preview';

/** Скільки співрозмовників перелічує підпис розмови без назви */
const LABEL_NAMES_LIMIT = 3;

export interface MessagePostedInput {
  conversationId: string;
  messageId: string;
  /** Знімок «хто дивився на розмову, коли писали» — їх не сповіщаємо (docs/chat.md §4.11) */
  viewerIds: readonly string[];
}

/**
 * Сповіщення про внутрішню репліку (CHAT-0.2c, design.md D4). Вся логіка «кому і що» тут, а
 * воркер лише викликає її в `runOnce`: так правило перевіряється проти справжньої БД з API e2e,
 * а вхідне з каналу (CHAT-2b) піде тим самим кодом.
 *
 * Отримувачі = активні учасники − автор − ті, хто дивився. Лише `TEXT`: системні записи
 * (вступ, вихід) не дзвонять нікому.
 */
@Injectable()
export class ChatNotifier {
  constructor(private readonly notifications: NotificationRecorder) {}

  async notifyMessagePosted(tx: Prisma.TransactionClient, input: MessagePostedInput): Promise<void> {
    const message = await tx.chatMessage.findFirst({
      where: { id: input.messageId, conversationId: input.conversationId },
      select: { kind: true, deletedAt: true, body: true, senderUserId: true, senderLabel: true },
    });
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        id: true,
        title: true,
        participants: {
          where: { leftAt: null },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    // Ретрай нічого б не змінив: рядка, про який повідомляє подія, немає
    if (!message || !conversation) {
      throw new NonRetryableMessageError(
        `Message ${input.messageId} or conversation ${input.conversationId} not found`,
      );
    }
    if (message.kind !== 'TEXT' || message.deletedAt !== null || message.body === null) {
      return;
    }

    const viewers = new Set(input.viewerIds);
    const recipients = conversation.participants.filter(
      (participant) => participant.userId !== message.senderUserId && !viewers.has(participant.userId),
    );
    if (recipients.length === 0 || message.senderUserId === null) {
      return;
    }

    const preview = toPreview(message.body);
    const actor = {
      type: 'user' as const,
      id: message.senderUserId,
      label: message.senderLabel ?? '',
    };

    // Підпис — під отримувача, як у екрані чату: назва, інакше хто ще в розмові. У парній розмові
    // це якраз автор. Рядок інбокса так самодостатній (без join на момент показу)
    for (const recipient of recipients) {
      const others = conversation.participants
        .filter((participant) => participant.userId !== recipient.userId)
        .slice(0, LABEL_NAMES_LIMIT)
        .map((participant) => participant.user.name ?? participant.user.email);

      await this.notifications.notify(tx, {
        type: 'chat.message_received',
        recipientIds: [recipient.userId],
        actor,
        payload: {
          conversation: {
            kind: 'conversation',
            id: conversation.id,
            label: conversation.title ?? others.join(', '),
          },
          preview,
        },
        target: { kind: 'conversation', id: conversation.id },
        groupKey: `conversation:${conversation.id}`,
      });
    }
  }

  /**
   * Вхідне від клієнта (CHAT-2b, design.md D8): сповіщення отримує лише ВІДПОВІДАЛЬНИЙ за розмову
   * і лише якщо не дивиться на неї. Нічия розмова нікого не сповіщає — це черга «нерозібраних» у
   * скриньці. Свій тип (`chat.customer_message_received`): відправник тут — контакт, а не користувач.
   */
  async notifyCustomerMessage(
    tx: Prisma.TransactionClient,
    input: MessagePostedInput,
  ): Promise<void> {
    const message = await tx.chatMessage.findFirst({
      where: { id: input.messageId, conversationId: input.conversationId },
      select: { kind: true, direction: true, deletedAt: true, body: true, seq: true },
    });
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        id: true,
        title: true,
        assigneeId: true,
        contact: {
          select: {
            displayName: true,
            addresses: { select: { value: true }, take: 1, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!message || !conversation) {
      throw new NonRetryableMessageError(
        `Message ${input.messageId} or conversation ${input.conversationId} not found`,
      );
    }
    if (
      message.kind !== 'TEXT' ||
      message.direction !== 'INBOUND' ||
      message.deletedAt !== null ||
      message.body === null ||
      conversation.assigneeId === null ||
      input.viewerIds.includes(conversation.assigneeId)
    ) {
      return;
    }

    // Воркер встигає за ~пів секунди; за цей час команда вже могла відповісти (і привласнити розмову
    // автору відповіді). Сповіщати про повідомлення, на яке вже відповіли, — шум (design.md D8)
    const answered = await tx.chatMessage.count({
      where: {
        conversationId: input.conversationId,
        direction: 'OUTBOUND',
        visibility: 'PUBLIC',
        seq: { gt: message.seq },
      },
    });
    if (answered > 0) {
      return;
    }

    await this.notifications.notify(tx, {
      type: 'chat.customer_message_received',
      recipientIds: [conversation.assigneeId],
      actor: { type: 'system' },
      payload: {
        conversation: {
          kind: 'conversation',
          id: conversation.id,
          label:
            conversation.title ??
            conversation.contact?.displayName ??
            conversation.contact?.addresses[0]?.value ??
            'Conversation',
        },
        preview: toPreview(message.body),
      },
      target: { kind: 'conversation', id: conversation.id },
      groupKey: `conversation:${conversation.id}`,
    });
  }
}
