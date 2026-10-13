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
}
