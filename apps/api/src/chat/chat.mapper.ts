import type { ChatMessage } from '@saas-skeleton/database';
import type {
  ChatMessageResponse,
  ConversationResponse,
  ConversationParticipantResponse,
} from '@saas-skeleton/contracts';
import type { StorageService } from '@saas-skeleton/shared';
import type { ConversationWithParticipants } from './chat.service';

/**
 * Prisma → відповідь. Явно, поле в поле: мапер — єдина межа, що не дає рядку
 * потрапити у відповідь цілком (CLAUDE.md, Backend module layering).
 */
export function toChatMessageResponse(message: ChatMessage): ChatMessageResponse {
  return {
    id: message.id,
    conversationId: message.conversationId,
    seq: message.seq,
    kind: message.kind,
    visibility: message.visibility,
    status: message.status,
    // Плоска трійка, а не вкладений юзер: senderLabel — снапшот на момент
    // написання, саме він тримає транскрипт читабельним після видалення людини
    senderType:
      message.senderType === 'system' || message.senderType === 'customer'
        ? message.senderType
        : 'user',
    senderId: message.senderUserId,
    senderLabel: message.senderLabel,
    body: message.body,
    payload: (message.payload ?? {}) as Record<string, unknown>,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Розмова для конкретного глядача: `unreadCount` і `lastReadSeq` — ЙОГО власні,
 * у двох учасників однієї розмови вони різні.
 *
 * `avatarUrl` presigned-иться тут, а не в сервісі, — та сама угода, що в
 * `/users`: підпис короткоживучий, тому його робить край, який віддає відповідь.
 */
export async function toConversationResponse(
  conversation: ConversationWithParticipants,
  viewerId: string,
  storage: StorageService,
): Promise<ConversationResponse> {
  const participants: ConversationParticipantResponse[] = await Promise.all(
    conversation.participants.map(async (participant) => {
      const avatar = participant.user.avatarFile;
      return {
        id: participant.user.id,
        email: participant.user.email,
        name: participant.user.name,
        avatarUrl:
          avatar?.status === 'READY'
            ? await storage.getDownloadUrl(avatar.thumbnailKey ?? avatar.key)
            : null,
        role: participant.role,
        joinedAt: participant.joinedAt.toISOString(),
      };
    }),
  );

  const viewer = conversation.participants.find((p) => p.userId === viewerId);

  return {
    id: conversation.id,
    kind: conversation.kind,
    // Колонка — вільний рядок (docs/chat.md §4.2); контракт звужує до двох
    // значень, і сервер створює лише 'private'
    access: conversation.access === 'tenant' ? 'tenant' : 'private',
    status: conversation.status,
    isDefault: conversation.isDefault,
    title: conversation.title,
    participants,
    contact: conversation.contact
      ? {
          id: conversation.contact.id,
          displayName: conversation.contact.displayName,
          channelNumber: conversation.channel?.displayPhoneNumber ?? null,
        }
      : null,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conversation.lastMessagePreview,
    unreadCount: viewer?.unreadCount ?? 0,
    lastReadSeq: viewer?.lastReadSeq ?? 0,
    createdAt: conversation.createdAt.toISOString(),
  };
}
