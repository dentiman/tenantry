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
  /**
   * Рядок членства того, хто питає. `null` — легально лише для клієнтської розмови (`access =
   * 'tenant'`), яку видно всім активним юзерам тенанта без участі; у внутрішній (`private`)
   * без членства доступу немає взагалі, тож там поле завжди заповнене.
   */
  membership: {
    userId: string;
    role: string;
    joinSeq: number;
    lastReadSeq: number;
    unreadCount: number;
    label: string;
  } | null;
};

/**
 * ЄДИНА функція доступу модуля чату (CHAT-2a: гілка `tenant` дописана — chat/customer-inbox).
 *
 * Дві межі, і вони різні:
 * - межу ТЕНАНТА тримає RLS (міграція `chat_conversations`);
 * - межу УЧАСНИКА тримає цей сервіс. RLS ізолює тенанти, а не людей усередині
 *   тенанта, тож приватний канал вона не захищає — і припущення «RLS уже все
 *   зробила» тут коштувало б читання чужого листування (docs/chat.md §5 п. 6).
 *
 * Чому окремий сервіс, а не умова `EXISTS (participant)` у кожному запиті: саме
 * розкопійована по хендлерах умова рано чи пізно десь не дописується. Правило
 * модуля — жоден запит до розмови не йде повз `assertAccess`.
 *
 * Резолвер від початку приймає `access`: гілка `tenant` дописалась одним рядком у
 * `canSee`, без зміни жодного виклику (docs/chat.md §6). Клієнтські розмови (CUSTOMER)
 * видно всім активним користувачам тенанта (O-W1); RBAC колись звузить це ТУТ же.
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
  async assertAccess(
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
    if (!conversation || !canSee(conversation.access, membership)) {
      throw new NotFoundException('Conversation not found');
    }

    const { participants: _participants, ...rest } = conversation;
    return {
      ...rest,
      membership: membership
        ? {
            userId: membership.userId,
            role: membership.role,
            joinSeq: membership.joinSeq,
            lastReadSeq: membership.lastReadSeq,
            unreadCount: membership.unreadCount,
            // Снапшот підпису для sender_label: ім'я, якщо є, інакше пошта —
            // та сама форма, що в payload системних записів
            label: membership.user.name ?? membership.user.email,
          }
        : null,
    };
  }
}

/**
 * Правило видимості. `private` — лише поточний учасник; `tenant` — будь-який активний юзер
 * тенанта (межу тенанта вже тримає RLS, а активність — guard автентифікації).
 * Невідомий `access` дає «не видно», а не «видно»: дефолт має бути закритим.
 */
function canSee(access: string, membership: { userId: string } | undefined): boolean {
  if (access === 'tenant') return true;
  return access === 'private' && membership !== undefined;
}
