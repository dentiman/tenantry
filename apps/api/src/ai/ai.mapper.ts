import type { AiConversation, AiMessage } from '@saas-skeleton/database';
import { citationsFor } from '@saas-skeleton/shared';
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
    // Перевірені цитати рахуються при читанні (AI-2a.3, design.md D7): лише фрагменти,
    // надані моделі в цій спробі, на чий `[n]` посилається поточний текст
    citations: citationsFor(message.content, message.knowledgeChunks).map(
      ({ n, title, heading, path }) => ({ n, title, heading, path }),
    ),
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
