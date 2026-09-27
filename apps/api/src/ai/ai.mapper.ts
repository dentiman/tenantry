import type { AiConversation, AiMessage } from '@saas-skeleton/database';
import type {
  AiConversationResponse,
  AiMessageErrorCode,
  AiMessageResponse,
} from '@saas-skeleton/contracts';

/**
 * Явне мапування Prisma → відповідь. Назовні НЕ йдуть ні `tenantId`, ні
 * `conversationId`, ні резерв обліку токенів (`model`/`promptTokens`/
 * `completionTokens`): вони належать адмінові й AI-1, а не панелі.
 */
export function toAiMessageResponse(message: AiMessage): AiMessageResponse {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    status: message.status,
    content: message.content,
    errorCode: message.errorCode as AiMessageErrorCode | null,
    attempt: message.attempt,
    chunkCount: message.chunkCount,
    createdAt: message.createdAt.toISOString(),
    completedAt: message.completedAt?.toISOString() ?? null,
  };
}

export function toAiConversationResponse(
  conversation: AiConversation,
  messages: AiMessage[],
): AiConversationResponse {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    messages: messages.map(toAiMessageResponse),
  };
}
