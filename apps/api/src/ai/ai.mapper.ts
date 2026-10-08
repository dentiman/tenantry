import type { AiConversation, AiMessage } from '@saas-skeleton/database';
import { citationsFor } from '@saas-skeleton/shared';
import { AI_CONVERSATION_TITLE_CHARS } from '@saas-skeleton/contracts';
import type {
  AiConversationResponse,
  AiConversationSummary,
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
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    messages: messages.map(toAiMessageResponse),
  };
}

/**
 * Рядок історії. `lastMessageAt` тут ніколи не null: розмова без жодного питання в
 * історію не потрапляє (`AiService.listConversations`), а `ask()` ставить його в тій
 * самій транзакції, що створює питання.
 */
export function toAiConversationSummary(
  conversation: AiConversation & { lastMessageAt: Date },
  firstQuestion: string | undefined,
): AiConversationSummary {
  const flat = (firstQuestion ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: conversation.id,
    status: conversation.status,
    title:
      flat.length > AI_CONVERSATION_TITLE_CHARS
        ? `${flat.slice(0, AI_CONVERSATION_TITLE_CHARS - 1)}…`
        : flat,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
  };
}
