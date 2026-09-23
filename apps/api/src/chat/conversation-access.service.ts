import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';

/** Розмова разом із рядком членства того, хто питає */
export type ConversationWithMembership = Prisma.ConversationGetPayload<{
  select: {
    id: true;
    kind: true;
    access: true;
    status: true;
    isDefault: true;
    title: true;
    lastSeq: true;
    lastMessageAt: true;
    lastMessagePreview: true;
    createdAt: true;
  };
}> & {
  membership: {
    userId: string;
    role: string;
    joinSeq: number;
    lastReadSeq: number;
    unreadCount: number;
    label: string;
  };
};

/**
 * ЄДИНА функція доступу модуля чату.
 *
 * Дві межі, і вони різні:
 * - межу ТЕНАНТА тримає RLS (міграція `chat_conversations`);
 * - межу УЧАСНИКА тримає цей сервіс. RLS ізолює тенанти, а не людей усередині
 *   тенанта, тож приватний канал вона не захищає — і припущення «RLS уже все
 *   зробила» тут коштувало б читання чужого листування (docs/chat.md §5 п. 6).
 *
 * Чому окремий сервіс, а не умова `EXISTS (participant)` у кожному запиті: саме
 * розкопійована по хендлерах умова рано чи пізно десь не дописується. Правило
 * модуля — жоден запит до розмови не йде повз `assertParticipant`.
 *
 * Резолвер від початку приймає `access`, хоча зараз розбирає лише `private`:
 * дописати гілку `tenant` у функцію, яка вже нею оперує, — рядок; додати їй
 * аргумент заднім числом — переписати кожен виклик (docs/chat.md §6).
 */
@Injectable()
export class ConversationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Розмова, до якої юзер має доступ, разом із його членством.
   *
   * Немає доступу — 404, а не 403: 403 підтвердив би, що така розмова існує, і
   * зробив би ендпоінт оракулом. Та сама відповідь для неіснуючої, чужої і
   * покинутої розмови — і для ADMIN теж: роль тут прав не дає.
   */
  async assertParticipant(
    conversationId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ConversationWithMembership> {
    const client = tx ?? this.prisma;

    const conversation = await client.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        kind: true,
        access: true,
        status: true,
        isDefault: true,
        title: true,
        lastSeq: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        createdAt: true,
        participants: {
          where: { userId, leftAt: null },
          select: {
            userId: true,
            role: true,
            joinSeq: true,
            lastReadSeq: true,
            unreadCount: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    const membership = conversation?.participants[0];
    if (!conversation || !membership || !canSee(conversation.access, membership)) {
      throw new NotFoundException('Conversation not found');
    }

    const { participants: _participants, ...rest } = conversation;
    return {
      ...rest,
      membership: {
        userId: membership.userId,
        role: membership.role,
        joinSeq: membership.joinSeq,
        lastReadSeq: membership.lastReadSeq,
        unreadCount: membership.unreadCount,
        // Снапшот підпису для sender_label: ім'я, якщо є, інакше пошта —
        // та сама форма, що в payload системних записів
        label: membership.user.name ?? membership.user.email,
      },
    };
  }
}

/**
 * Правило видимості. `tenant` у переліку є, але НЕ обробляється: сервер таких
 * розмов не створює, і поки їх нема кому створити — гілки під них не пишемо.
 * Невідомий `access` дає «не видно», а не «видно»: дефолт має бути закритим.
 */
function canSee(access: string, membership: { userId: string } | undefined): boolean {
  return access === 'private' && membership !== undefined;
}
